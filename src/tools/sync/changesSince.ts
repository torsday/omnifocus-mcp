/**
 * `changes_since` MCP tool — incremental, field-level sync deltas (#819).
 *
 * Sync-style consumers that track OmniFocus state shouldn't re-fetch every
 * task and project on each poll. `changes_since` returns a `syncToken`; on the
 * next call with that token it returns only what changed since — and for
 * modified entities, only the changed *fields* (`{ id, changes }`), a 5–10×
 * payload cut vs. whole records.
 *
 * Protocol:
 * - First call (no token) — `reset: true`, every entity in `added`, plus a
 *   fresh `syncToken`. This is the bootstrap snapshot.
 * - Later call (with token) — `reset: false`, `added` = entities new since the
 *   token, `modified` = `{ id, changes }` field-level deltas. A fresh token is
 *   returned each time; use the latest.
 * - Unknown/expired token — `reset: true` full re-sync (tokens live ~10 min,
 *   in-memory, not across restarts); the consumer should discard local state.
 *
 * Field-level diffs need the prior state, which OmniFocus's `modificationDate`
 * doesn't carry — so the server snapshots returned entities under each token
 * (see {@link file://../../state/syncSnapshotStore.ts}) and diffs against it.
 *
 * Limitation (v1): deletions are NOT reported — there is no deletion signal in
 * OmniFocus's change feed. Consumers should periodically reconcile against
 * `task_list` / `project_list`. See ADR-0026 and the deletion follow-up issue.
 *
 * @see docs/adr/0026-sync-delta-protocol.md
 * @see src/state/syncSnapshotStore.ts — prior-state store
 * @see src/domain/diff.ts — field-level diff
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { diffRecord } from "../../domain/diff.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import type { Project } from "../../domain/project.js";
import type { Task } from "../../domain/task.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { NotFound } from "../../errors/index.js";
import {
  syncSnapshotStore as defaultStore,
  type SyncSnapshotStore,
} from "../../state/syncSnapshotStore.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const CHANGES_SINCE_DESCRIPTION =
  "Incremental sync feed: return what changed since the last call. " +
  "Call with no args to bootstrap (returns every task/project in `added` plus a `syncToken`); " +
  "call again passing the previous `syncToken` to get only changes since then. " +
  "Returns { reset, syncToken, tasks: { added, modified }, projects: { added, modified } }. " +
  "modified entries are field-level deltas { id, changes } — only the fields that changed, not the whole record. " +
  "reset=true means a full snapshot (first call, or the token expired/unknown — discard local state). " +
  "Always use the returned syncToken for the next call; tokens live ~10 min and do not survive a server restart. " +
  "Deletions are reported in `removed` only when you pass includeRemoved:true (it needs a full scan); otherwise they are not tracked. " +
  "Read-only; no side effects. " +
  "Example: changes_since({ syncToken: 'abc123' })";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const changesSinceInputSchema = z.object({
  syncToken: z
    .string()
    .optional()
    .describe("Token from a prior changes_since call. Omit to bootstrap a full snapshot."),
  includeRemoved: z
    .boolean()
    .optional()
    .describe(
      "Report deleted entity IDs in `removed`. Default false — detecting deletions needs a full enumeration, so this trades the cheap incremental path for completeness. Set true only when you must track deletions; otherwise reconcile periodically with task_list / project_list.",
    ),
});
export type ChangesSinceInput = z.infer<typeof changesSinceInputSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface EntityDelta<T> {
  id: string;
  changes: Partial<T>;
}

export interface ChangesSinceData {
  /** True when this is a full snapshot (bootstrap, or token expired/unknown). */
  reset: boolean;
  /** Opaque token to pass on the next call. */
  syncToken: string;
  tasks: { added: Task[]; modified: EntityDelta<Task>[] };
  projects: { added: Project[]; modified: EntityDelta<Project>[] };
  /**
   * Deleted entity IDs since the token. Present only when the call passed
   * `includeRemoved: true` (detecting deletions needs a full enumeration);
   * absent otherwise, so "absent" ≠ "nothing deleted".
   */
  removed?: { tasks: string[]; projects: string[] };
}

/**
 * Reconcile a prior snapshot against the current full entity list: classify
 * each into added / modified (field-level) / removed, and return the next
 * snapshot map. Used by the `includeRemoved` path, which trades the cheap
 * incremental fetch for a full enumeration that can see deletions.
 */
function reconcileEntities<T extends { id: string }>(
  priorById: Map<string, T>,
  current: T[],
): { added: T[]; modified: EntityDelta<T>[]; removed: string[]; nextById: Map<string, T> } {
  const added: T[] = [];
  const modified: EntityDelta<T>[] = [];
  const nextById = new Map<string, T>();
  const currentIds = new Set<string>();
  for (const cur of current) {
    const id = cur.id;
    currentIds.add(id);
    nextById.set(id, cur);
    const before = priorById.get(id);
    if (before === undefined) {
      added.push(cur);
    } else {
      const changes = diffRecord(before, cur);
      if (Object.keys(changes).length > 0) modified.push({ id, changes });
    }
  }
  const removed: string[] = [];
  for (const id of priorById.keys()) {
    if (!currentIds.has(id)) removed.push(id);
  }
  return { added, modified, removed, nextById };
}

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface ChangesSinceContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /** Snapshot store (defaults to the module singleton; override for tests). */
  store?: SyncSnapshotStore;
  /** Clock for the snapshot's lower-bound timestamp (defaults to wall clock). */
  now?: () => Date;
}

/** Pure handler — callable directly in unit tests. */
export async function handleChangesSince(input: ChangesSinceInput, ctx: ChangesSinceContext) {
  const store = ctx.store ?? defaultStore;
  const nowIso = (ctx.now ?? (() => new Date()))().toISOString();
  const prior = input.syncToken !== undefined ? store.get(input.syncToken) : undefined;

  // Bootstrap / re-sync: a missing-or-expired token that was supplied is a reset.
  if (prior === undefined) {
    // A full snapshot — whether this is the first call or a token that
    // expired/was unknown. Either way the consumer (re)initializes from it.
    return bootstrap(ctx, store, nowIso);
  }

  // Deletion-aware path: a removed entity has no modificationDate for
  // getChangesSince to surface, so reporting `removed` requires enumerating
  // the current full state and reconciling it against the prior snapshot.
  // Opt-in (`includeRemoved`) because it trades the cheap incremental fetch
  // for a full scan. See ADR-0026.
  if (input.includeRemoved === true) {
    const [tasks, projects] = await Promise.all([
      ctx.adapter.listTasks({}),
      ctx.adapter.listProjects(),
    ]);
    const t = reconcileEntities(prior.tasksById, tasks);
    const p = reconcileEntities(prior.projectsById, projects);
    if (input.syncToken !== undefined) store.delete(input.syncToken);
    const syncToken = store.register({
      tasksById: t.nextById,
      projectsById: p.nextById,
      issuedAtIso: nowIso,
    });
    const data: ChangesSinceData = {
      reset: false,
      syncToken,
      tasks: { added: t.added, modified: t.modified },
      projects: { added: p.added, modified: p.modified },
      removed: { tasks: t.removed, projects: p.removed },
    };
    return ok(data, ctx.makeMeta());
  }

  // Default delta: fetch only the changed set (cheap) and diff each against
  // the prior snapshot. No deletion detection (see above).
  const changed = await ctx.adapter.getChangesSince(prior.issuedAtIso);

  const tasksAdded: Task[] = [];
  const tasksModified: EntityDelta<Task>[] = [];
  const nextTasks = new Map(prior.tasksById);
  for (const id of changed.taskIds) {
    let current: Task;
    try {
      current = await ctx.adapter.getTask(TaskId.of(id));
    } catch (err) {
      // Changed-then-vanished between query and fetch — not reported in v1.
      // ONLY NotFound may be swallowed: any other failure (Timeout, OFBusy,
      // ScriptError, …) must abort the call before the token is superseded,
      // or the skipped entity's delta would be lost forever — its
      // modificationDate predates the next snapshot's issuedAtIso. The old
      // token stays registered, so the caller retries with it and the
      // change is re-reported.
      if (err instanceof NotFound) continue;
      throw err;
    }
    nextTasks.set(id, current);
    const before = prior.tasksById.get(id);
    if (before === undefined) {
      tasksAdded.push(current);
    } else {
      const changes = diffRecord(before, current);
      if (Object.keys(changes).length > 0) tasksModified.push({ id, changes });
    }
  }

  const projectsAdded: Project[] = [];
  const projectsModified: EntityDelta<Project>[] = [];
  const nextProjects = new Map(prior.projectsById);
  for (const id of changed.projectIds) {
    let current: Project;
    try {
      current = await ctx.adapter.getProject(ProjectId.of(id));
    } catch (err) {
      if (err instanceof NotFound) continue; // Same vanished-entity rule as tasks above.
      throw err;
    }
    nextProjects.set(id, current);
    const before = prior.projectsById.get(id);
    if (before === undefined) {
      projectsAdded.push(current);
    } else {
      const changes = diffRecord(before, current);
      if (Object.keys(changes).length > 0) projectsModified.push({ id, changes });
    }
  }

  // Supersede the consumed token with a fresh snapshot (prior overlaid with the
  // changed set — no full re-scan needed on the steady-state delta path).
  if (input.syncToken !== undefined) store.delete(input.syncToken);
  const syncToken = store.register({
    tasksById: nextTasks,
    projectsById: nextProjects,
    issuedAtIso: nowIso,
  });

  const data: ChangesSinceData = {
    reset: false,
    syncToken,
    tasks: { added: tasksAdded, modified: tasksModified },
    projects: { added: projectsAdded, modified: projectsModified },
  };
  return ok(data, ctx.makeMeta());
}

/** Full-snapshot path: enumerate everything as `added` and mint a fresh token. */
async function bootstrap(ctx: ChangesSinceContext, store: SyncSnapshotStore, nowIso: string) {
  const [tasks, projects] = await Promise.all([
    ctx.adapter.listTasks({}),
    ctx.adapter.listProjects(),
  ]);
  const tasksById = new Map(tasks.map((t) => [t.id as string, t]));
  const projectsById = new Map(projects.map((p) => [p.id as string, p]));
  const syncToken = store.register({ tasksById, projectsById, issuedAtIso: nowIso });

  const data: ChangesSinceData = {
    reset: true,
    syncToken,
    tasks: { added: tasks, modified: [] },
    projects: { added: projects, modified: [] },
  };
  return ok(data, ctx.makeMeta());
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerChangesSinceTool(server: McpServer, ctx: ChangesSinceContext) {
  return server.registerTool(
    "changes_since",
    { description: CHANGES_SINCE_DESCRIPTION, inputSchema: changesSinceInputSchema.shape },
    async (args: ChangesSinceInput) => {
      const envelope = await handleChangesSince(args, ctx);
      return toolResponse(envelope);
    },
  );
}
