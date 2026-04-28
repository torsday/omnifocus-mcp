/**
 * `task_reclassify` MCP tool — predicate-driven bulk reclassification with
 * mandatory dry-run.
 *
 * Compose-in-one of `task_search` + `task_batch_assign` with a forcing
 * function: the agent MUST run a dry-run first, then echo the matched
 * count back as `confirmation` to apply. Eliminates the silent-failure
 * mode where a too-broad predicate blasts unintended tasks.
 *
 * Predicate is a discriminated-union AST (title-contains / tag / project /
 * and / or / not), evaluated in TypeScript over the result of
 * `adapter.listTasks({ completed: false })`. JXA's `whose()` doesn't
 * express logical OR or recursive NOT cleanly; the in-TS pass costs one
 * extra full task list read but gives exact, predictable semantics.
 *
 * Hard cap of 200 tasks on `dryRun: false` — for larger sets the agent
 * uses `task_batch_update` with explicit IDs.
 *
 * @see #471 — initial implementation
 * @see src/domain/taskPredicate.ts — pure predicate evaluator
 * @see src/tools/task/batchAssign.ts — orchestration this tool delegates to
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import type { InvalidatingCache } from "../../cache/invalidation.js";
import { ProjectId, TagId, TaskId } from "../../domain/ids.js";
import type { Task } from "../../domain/task.js";
import { evaluatePredicate, type TaskPredicate } from "../../domain/taskPredicate.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { validateRefined } from "../../errors/validateRefined.js";
import { applyTagDiff, handleTaskBatchAssign } from "./batchAssign.js";

// ---------------------------------------------------------------------------
// Tool description (DESIGN §6.8 four-section shape)
// ---------------------------------------------------------------------------

export const TASK_RECLASSIFY_DESCRIPTION =
  "Predicate-driven bulk task reclassification with a mandatory two-phase contract. " +
  "Phase 1 (dryRun: true): match tasks by predicate, return { matched, proposed: [{taskId, before, after}] } " +
  "with no mutations. Phase 2 (dryRun: false): require `confirmation` echoing the matched count from the " +
  "prior dry-run; mismatch fails fast. Hard cap: dryRun: false rejects > 200 matches (use task_batch_update " +
  "with explicit IDs for larger sets). Predicate is a discriminated-union AST: " +
  "{ kind: 'title-contains', value, caseSensitive? } | { kind: 'tag', tagId } | { kind: 'project', projectId } | " +
  "{ kind: 'and', predicates: [] } | { kind: 'or', predicates: [] } | { kind: 'not', predicate }. " +
  "Changes apply uniformly to every match: addTags, removeTags, setProject, setFlagged. " +
  "Do NOT use this tool when you have explicit task IDs — call task_batch_update directly. " +
  "Prefer task_reclassify whenever the targets are described by a rule rather than a list, so the dry-run " +
  "diff surfaces to the user before any write. " +
  "Side effects (apply phase only): writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need changes to appear on other devices. " +
  'Example: task_reclassify({ predicate: { kind: "tag", tagId: "tag123" }, changes: { setFlagged: true }, dryRun: true }) ' +
  'Example: task_reclassify({ predicate: { kind: "tag", tagId: "tag123" }, changes: { setFlagged: true }, dryRun: false, confirmation: "3" })';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HARD_CAP = 200;

// ---------------------------------------------------------------------------
// Predicate schema (recursive)
// ---------------------------------------------------------------------------

const predicateSchema: z.ZodType<TaskPredicate> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("title-contains"),
      value: z.string().describe("Substring to search for in task names."),
      caseSensitive: z
        .boolean()
        .optional()
        .describe("When true, exact-case match. Default false (case-insensitive)."),
    }),
    z.object({
      kind: z.literal("tag"),
      tagId: TagId.schema.describe("Match tasks carrying this tag."),
    }),
    z.object({
      kind: z.literal("project"),
      projectId: ProjectId.schema.describe("Match tasks in this project."),
    }),
    z.object({
      kind: z.literal("and"),
      predicates: z.array(predicateSchema).describe("All children must match."),
    }),
    z.object({
      kind: z.literal("or"),
      predicates: z.array(predicateSchema).describe("Any child match suffices."),
    }),
    z.object({
      kind: z.literal("not"),
      predicate: predicateSchema.describe("Inverts the inner predicate's result."),
    }),
  ]),
);

// ---------------------------------------------------------------------------
// Changes schema
// ---------------------------------------------------------------------------

const changesSchema = z
  .object({
    addTags: z.array(TagId.schema).optional().describe("Tag IDs to add to every match."),
    removeTags: z.array(TagId.schema).optional().describe("Tag IDs to remove from every match."),
    setProject: ProjectId.schema.optional().describe("Move every match to this project."),
    setFlagged: z.boolean().optional().describe("Set the flagged state on every match."),
  })
  .refine(
    (c) =>
      c.addTags !== undefined ||
      c.removeTags !== undefined ||
      c.setProject !== undefined ||
      c.setFlagged !== undefined,
    {
      message: "changes must set at least one of addTags, removeTags, setProject, or setFlagged",
    },
  );

type Changes = z.infer<typeof changesSchema>;

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskReclassifyInputBaseSchema = z.object({
  predicate: predicateSchema.describe(
    "AST for selecting tasks. Composable via and/or/not. Always evaluated against open " +
      "(non-completed, non-dropped) tasks.",
  ),
  changes: changesSchema.describe("Changes applied uniformly to every matched task."),
  dryRun: z
    .boolean()
    .default(true)
    .describe(
      "Default true — return the diff without mutating. false requires `confirmation` " +
        "echoing the matched count from a prior dry-run.",
    ),
  confirmation: z
    .string()
    .optional()
    .describe(
      "When dryRun is false, the matched count from the most recent dry-run, as a string " +
        '(e.g. "42"). Mismatch with the actual current match count fails the call fast.',
    ),
});

export const taskReclassifyInputSchema = taskReclassifyInputBaseSchema.refine(
  (v) => v.dryRun || v.confirmation !== undefined,
  {
    message: "confirmation is required when dryRun is false",
    path: ["confirmation"],
  },
);

export type TaskReclassifyInput = z.infer<typeof taskReclassifyInputSchema>;

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export interface TaskReclassifyTaskBefore {
  projectId: string | null;
  tagIds: string[];
  flagged: boolean;
}

export interface TaskReclassifyProposed {
  taskId: string;
  name: string;
  before: TaskReclassifyTaskBefore;
  after: TaskReclassifyTaskBefore;
}

// ---------------------------------------------------------------------------
// Helpers — pure
// ---------------------------------------------------------------------------

/** Given a task and a `changes` payload, compute the post-change shape. */
export function computeAfter(task: Task, changes: Changes): TaskReclassifyTaskBefore {
  const projectId =
    changes.setProject !== undefined
      ? String(changes.setProject)
      : task.projectId === null
        ? null
        : String(task.projectId);
  const tagIds = applyTagDiff(task.tagIds, changes.addTags, changes.removeTags).map(String);
  const flagged = changes.setFlagged !== undefined ? changes.setFlagged : task.flagged;
  return { projectId, tagIds, flagged };
}

/** Snapshot of a task's reclassify-relevant fields. */
export function snapshotBefore(task: Task): TaskReclassifyTaskBefore {
  return {
    projectId: task.projectId === null ? null : String(task.projectId),
    tagIds: task.tagIds.map(String),
    flagged: task.flagged,
  };
}

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskReclassifyContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleTaskReclassify(input: TaskReclassifyInput, ctx: TaskReclassifyContext) {
  // Re-parse against the refined schema — the SDK only validates the base
  // shape, so the dryRun→confirmation cross-field rule needs explicit
  // enforcement here. See src/errors/validateRefined.ts.
  validateRefined(taskReclassifyInputSchema, input);

  // Phase 0: pull all open tasks and apply the predicate in TS.
  // We don't include completed/dropped tasks — reclassification of completed
  // work is out of scope for the v1 contract.
  const allOpen = await ctx.adapter.listTasks({ completed: false });
  const matched = allOpen.filter((t) => evaluatePredicate(input.predicate, t));

  // Phase 1: dry-run — return the diff, no mutations.
  if (input.dryRun) {
    const proposed: TaskReclassifyProposed[] = matched.map((task) => ({
      taskId: String(task.id),
      name: task.name,
      before: snapshotBefore(task),
      after: computeAfter(task, input.changes),
    }));
    return ok(
      {
        phase: "dryRun" as const,
        matched: matched.length,
        proposed,
      },
      ctx.makeMeta(),
    );
  }

  // Phase 2: apply. confirmation must echo the current match count.
  // (Schema already enforced confirmation is present when dryRun is false.)
  const expected = String(matched.length);
  if (input.confirmation !== expected) {
    return ok(
      {
        phase: "stale-confirmation" as const,
        matched: matched.length,
        confirmation: input.confirmation,
        message: `confirmation must equal the current match count (${expected}); the underlying task set may have changed since the dry-run`,
      },
      ctx.makeMeta(),
    );
  }

  // Hard cap: refuse oversized batches.
  if (matched.length > HARD_CAP) {
    return ok(
      {
        phase: "over-cap" as const,
        matched: matched.length,
        cap: HARD_CAP,
        message: `${matched.length} matches exceeds the ${HARD_CAP}-task hard cap; use task_batch_update with explicit IDs for larger sets`,
      },
      ctx.makeMeta(),
    );
  }

  // Build the assignments shape that task_batch_assign understands and
  // delegate to its handler. This is the "guarded composition" — we don't
  // duplicate move + tag-diff orchestration.
  const assignments = matched.map((task) => ({
    taskId: TaskId.of(String(task.id)),
    ...(input.changes.setProject !== undefined && { projectId: input.changes.setProject }),
    ...(input.changes.addTags !== undefined && { addTagIds: input.changes.addTags }),
    ...(input.changes.removeTags !== undefined && { removeTagIds: input.changes.removeTags }),
    ...(input.changes.setFlagged !== undefined && { flagged: input.changes.setFlagged }),
  }));

  // Empty-changes guard (defense-in-depth — schema refines for this too).
  if (assignments.length === 0) {
    return ok(
      {
        phase: "applied" as const,
        matched: 0,
        assigned: [],
        failed: [],
      },
      ctx.makeMeta(),
    );
  }

  const innerEnv = await handleTaskBatchAssign({ assignments }, ctx);

  // Unwrap the inner ok envelope and reshape under our own phase label.
  if (!("data" in innerEnv)) {
    // batchAssign returns ok() in all our paths today; surface the inner
    // shape verbatim if it ever changes.
    return innerEnv;
  }

  return ok(
    {
      phase: "applied" as const,
      matched: matched.length,
      assigned: innerEnv.data.assigned,
      failed: innerEnv.data.failed,
    },
    ctx.makeMeta({ syncPending: innerEnv.data.assigned.length > 0 }),
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskReclassifyTool(server: McpServer, ctx: TaskReclassifyContext) {
  return server.registerTool(
    "task_reclassify",
    {
      description: TASK_RECLASSIFY_DESCRIPTION,
      inputSchema: taskReclassifyInputBaseSchema.shape,
    },
    async (args: TaskReclassifyInput) => {
      const envelope = await handleTaskReclassify(args, ctx);
      return toolResponse(envelope);
    },
  );
}
