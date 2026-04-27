/**
 * `omnifocus://retrospective` MCP resource.
 *
 * Closes the weekly-review reflection loop: capture → execute → reflect.
 * Returns a structured retrospective for a date range — what got done, what
 * got dropped, what got rolled (deferred forward) — so an agent driving a
 * weekly-review prompt can produce real prose retrospectives without
 * client-side aggregation.
 *
 * URI: `omnifocus://retrospective{?from,to}`
 *   - `from` (optional, default 7 days ago): start of window, ISO-8601
 *   - `to`   (optional, default now):         end of window,   ISO-8601
 *
 * Payload shape:
 *   {
 *     window: { from: string; to: string },
 *     completed: { taskId, name, projectId, completedAt, age_days_at_completion }[]
 *     dropped:   { taskId, name, projectId, droppedAt }[]
 *     rolled:    { taskId, name, projectId, deferDate }[]
 *     summary:   { completedCount, droppedCount, rolledCount, projectsActive }
 *   }
 *
 * Fidelity notes:
 * - `rolled` is a heuristic proxy for "deferred forward in this window":
 *   active tasks with a deferDate that were modified within the window. OF
 *   doesn't expose when a deferDate was last changed, so we cannot compute
 *   a true defer-date hop count or a "moved forward by N days" delta. The
 *   ticket (#474) accepts this approximation; a follow-up could maintain a
 *   side-table of deferDate changes via mutation hooks.
 * - `projectsActive` counts distinct project IDs touched across completed +
 *   dropped + rolled — the project surface that saw any kind of activity.
 *
 * @see #474
 * @see DESIGN.md §28 — MCP resources
 * @see src/resources/recentActivity.ts — sibling pattern (different window semantics)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const RETROSPECTIVE_URI_TEMPLATE = "omnifocus://retrospective{?from,to}";

/** Default window: trailing 7 days. */
export const RETROSPECTIVE_DEFAULT_DAYS = 7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetrospectivePayload {
  window: {
    from: string;
    to: string;
  };
  completed: Array<{
    taskId: string;
    name: string;
    projectId: string | null;
    completedAt: string;
    age_days_at_completion: number;
  }>;
  dropped: Array<{
    taskId: string;
    name: string;
    projectId: string | null;
    droppedAt: string;
  }>;
  rolled: Array<{
    taskId: string;
    name: string;
    projectId: string | null;
    deferDate: string;
  }>;
  summary: {
    completedCount: number;
    droppedCount: number;
    rolledCount: number;
    projectsActive: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers — pure, exported for testing
// ---------------------------------------------------------------------------

/**
 * Resolve `from`/`to` URI variables to a concrete window. Defaults to the
 * trailing `RETROSPECTIVE_DEFAULT_DAYS` when both are omitted; partial
 * (only `from` or only `to`) is honoured by filling the missing side with
 * the conventional default. Invalid ISO inputs fall back to the defaults
 * so a malformed URI never blows up the resource — agents get a sensible
 * window even when they pass garbage.
 */
export function resolveWindow(
  fromRaw: string | undefined,
  toRaw: string | undefined,
  now: () => Date = () => new Date(),
): { from: string; to: string } {
  const nowDate = now();
  const defaultTo = nowDate.toISOString();
  const defaultFrom = new Date(
    nowDate.getTime() - RETROSPECTIVE_DEFAULT_DAYS * 86_400_000,
  ).toISOString();

  const from = isIso(fromRaw) ? fromRaw : defaultFrom;
  const to = isIso(toRaw) ? toRaw : defaultTo;

  // Clamp to a sane order if the agent passed them swapped.
  if (from > to) {
    return { from: to, to: from };
  }
  return { from, to };
}

function isIso(s: string | undefined): s is string {
  if (s === undefined || s === null || s === "") return false;
  // Conservative ISO-8601 check: parseable and round-trips through Date.
  const d = new Date(s);
  return Number.isFinite(d.getTime());
}

/**
 * Build the retrospective payload from adapter data.
 *
 * Exported separately from the registration function so unit tests can call
 * it directly with a mock adapter without wiring up an MCP server.
 */
export async function buildRetrospectivePayload(
  adapter: OmniFocusAdapter,
  window: { from: string; to: string },
): Promise<RetrospectivePayload> {
  const { from, to } = window;

  // Three independent fetches — completed/dropped/active — run in parallel.
  // - completed: adapter supports `completedSince` filter; we apply the
  //   upper bound (`to`) in TS since adapter has no `completedBefore`.
  // - dropped: returned by `listTasks({ completed: false })` (dropped tasks
  //   are not "completed" in OF's data model). Filter by droppedAt in window.
  // - rolled: active tasks with a deferDate, modifiedAt in window.
  const [completedSince, incompleteTasks] = await Promise.all([
    adapter.listTasks({ completed: true, completedSince: from }),
    adapter.listTasks({ completed: false }),
  ]);

  // ── completed ─────────────────────────────────────────────────────────────
  const completed = completedSince
    .filter((t) => t.completedAt !== null && t.completedAt <= to)
    .map((t) => {
      const completedAt = t.completedAt as string;
      const ageMs = new Date(completedAt).getTime() - new Date(t.createdAt).getTime();
      return {
        taskId: String(t.id),
        name: t.name,
        projectId: t.projectId !== null ? String(t.projectId) : null,
        completedAt,
        age_days_at_completion: Math.max(0, Math.round(ageMs / 86_400_000)),
      };
    })
    .sort((a, b) => (b.completedAt > a.completedAt ? 1 : b.completedAt < a.completedAt ? -1 : 0));

  // ── dropped ───────────────────────────────────────────────────────────────
  const dropped = incompleteTasks
    .filter((t) => t.dropped && t.droppedAt !== null && t.droppedAt >= from && t.droppedAt <= to)
    .map((t) => ({
      taskId: String(t.id),
      name: t.name,
      projectId: t.projectId !== null ? String(t.projectId) : null,
      droppedAt: t.droppedAt as string,
    }))
    .sort((a, b) => (b.droppedAt > a.droppedAt ? 1 : b.droppedAt < a.droppedAt ? -1 : 0));

  // ── rolled ────────────────────────────────────────────────────────────────
  // Heuristic: active tasks with deferDate, modifiedAt in window. OF doesn't
  // expose deferDate change history, so we approximate "deferred forward in
  // this window" via modifiedAt as the change-time proxy.
  const rolled = incompleteTasks
    .filter((t) => !t.dropped && t.deferDate !== null && t.modifiedAt >= from && t.modifiedAt <= to)
    .map((t) => ({
      taskId: String(t.id),
      name: t.name,
      projectId: t.projectId !== null ? String(t.projectId) : null,
      deferDate: t.deferDate as string,
    }))
    .sort((a, b) => (b.deferDate > a.deferDate ? 1 : b.deferDate < a.deferDate ? -1 : 0));

  // ── summary.projectsActive ────────────────────────────────────────────────
  // Distinct project IDs across all three sections.
  const projectIds = new Set<string>();
  for (const t of completed) {
    if (t.projectId !== null) projectIds.add(t.projectId);
  }
  for (const t of dropped) {
    if (t.projectId !== null) projectIds.add(t.projectId);
  }
  for (const t of rolled) {
    if (t.projectId !== null) projectIds.add(t.projectId);
  }

  return {
    window: { from, to },
    completed,
    dropped,
    rolled,
    summary: {
      completedCount: completed.length,
      droppedCount: dropped.length,
      rolledCount: rolled.length,
      projectsActive: projectIds.size,
    },
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerRetrospectiveResource(server: McpServer, adapter: OmniFocusAdapter): void {
  server.registerResource(
    "omnifocus-retrospective",
    new ResourceTemplate(RETROSPECTIVE_URI_TEMPLATE, { list: undefined }),
    {
      description:
        "Retrospective for a date range — closes the weekly-review reflection loop. " +
        "Returns tasks completed (with age-at-completion in days), tasks dropped, and tasks 'rolled' (deferred-forward heuristic) within the window, plus a summary count and the distinct-projects-active count. " +
        "Defaults to the trailing 7 days when from/to are omitted; partial windows fill the missing side with the conventional default. " +
        "Fidelity notes: 'rolled' is a heuristic — OF does not expose deferDate change history, so we use modifiedAt-in-window as a proxy for 'recently re-deferred'. Treat as a signal, not an exact count of defer hops. " +
        "Cached — historical data doesn't change quickly. Read-only.",
      mimeType: "application/json",
    },
    async (_uri, variables) => {
      const vars = variables as Record<string, string | undefined>;
      const window = resolveWindow(vars.from, vars.to);
      const payload = await buildRetrospectivePayload(adapter, window);

      // Build the canonical URI back from the resolved window so cache keys
      // line up with the request the agent actually receives.
      const uri = `omnifocus://retrospective?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`;

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );
}
