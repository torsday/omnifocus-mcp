/**
 * `omnifocus://recent-activity` MCP resource.
 *
 * Returns a structured activity feed for a rolling time window, making it
 * safe and cheap to call at every session start so the agent is already
 * oriented before the first prompt fires.
 *
 * URI: `omnifocus://recent-activity{?hours}`
 *   - `hours` (optional, default 24, max 168): how far back to look
 *
 * Payload shape:
 *   {
 *     window: { hours: number; since: string },
 *     tasksCreated:   { taskId, name, projectId, createdAt }[]
 *     tasksCompleted: { taskId, name, projectId, completedAt, age_days_at_completion }[]
 *     tasksDropped:   { taskId, name, projectId, droppedAt }[]
 *     tasksDeferred:  { taskId, name, projectId, deferDate }[]
 *     projectsModified: { projectId, name, status, modifiedAt }[]
 *     summary: { taskCreatedCount, taskCompletedCount, taskDroppedCount, taskDeferredCount, projectsAffected }
 *   }
 *
 * All sections are sorted by timestamp descending (most recent first).
 * Empty sections return `[]` — never omitted.
 *
 * Fidelity notes:
 * - `tasksCreated` includes active tasks only (not tasks that were created
 *   _and_ completed within the window; those appear only in `tasksCompleted`).
 * - `tasksDeferred` uses `modifiedAt >= since && deferDate !== null` as a proxy
 *   for "recently deferred" — OF does not expose when a deferDate was set.
 *   Any task modified in the window that carries a deferDate appears here.
 * - `projectsModified` includes any project with `modifiedAt` in the window,
 *   not just status changes — OF does not surface the previous status value.
 *
 * @see DESIGN.md §28 — MCP resources
 * @see docs/adr/0006-read-cache-strategy.md
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const RECENT_ACTIVITY_URI_TEMPLATE = "omnifocus://recent-activity{?hours}";
export const RECENT_ACTIVITY_DEFAULT_HOURS = 24;
export const RECENT_ACTIVITY_MAX_HOURS = 168; // 7 days

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecentActivityPayload {
  window: {
    hours: number;
    since: string;
  };
  tasksCreated: Array<{
    taskId: string;
    name: string;
    projectId: string | null;
    createdAt: string;
  }>;
  tasksCompleted: Array<{
    taskId: string;
    name: string;
    projectId: string | null;
    completedAt: string;
    age_days_at_completion: number;
  }>;
  tasksDropped: Array<{
    taskId: string;
    name: string;
    projectId: string | null;
    droppedAt: string;
  }>;
  tasksDeferred: Array<{
    taskId: string;
    name: string;
    projectId: string | null;
    deferDate: string;
  }>;
  projectsModified: Array<{
    projectId: string;
    name: string;
    status: string;
    modifiedAt: string;
  }>;
  summary: {
    taskCreatedCount: number;
    taskCompletedCount: number;
    taskDroppedCount: number;
    taskDeferredCount: number;
    projectsAffected: number;
  };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Parse the `hours` variable from the URI template match, clamping to [1, MAX]. */
export function parseHours(raw: string | undefined): number {
  if (raw === undefined || raw === null || raw === "") {
    return RECENT_ACTIVITY_DEFAULT_HOURS;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return RECENT_ACTIVITY_DEFAULT_HOURS;
  return Math.min(Math.max(1, Math.round(n)), RECENT_ACTIVITY_MAX_HOURS);
}

/**
 * Build the recent-activity payload from adapter data.
 *
 * Exported separately from the registration function so unit tests can call
 * it directly with a mock adapter without wiring up an MCP server.
 */
export async function buildRecentActivityPayload(
  adapter: OmniFocusAdapter,
  hours: number,
): Promise<RecentActivityPayload> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  // Fetch data in parallel: three independent adapter calls.
  const [incompleteTasks, completedTasks, allProjects] = await Promise.all([
    // completed: false includes both active tasks AND dropped tasks (dropped ≠ completed in OF)
    adapter.listTasks({ completed: false }),
    adapter.listTasks({ completed: true, completedSince: since }),
    adapter.listProjects(),
  ]);

  // ── tasksCreated ──────────────────────────────────────────────────────────
  // Active (non-dropped) tasks created within the window.
  const tasksCreated = incompleteTasks
    .filter((t) => !t.dropped && t.createdAt >= since)
    .map((t) => ({
      taskId: String(t.id),
      name: t.name,
      projectId: t.projectId !== null ? String(t.projectId) : null,
      createdAt: t.createdAt,
    }))
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0));

  // ── tasksCompleted ────────────────────────────────────────────────────────
  const tasksCompleted = completedTasks
    .filter((t) => t.completedAt !== null)
    .map((t) => {
      const completedAt = t.completedAt!;
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

  // ── tasksDropped ──────────────────────────────────────────────────────────
  // Dropped tasks (dropped: true, droppedAt within window).
  const tasksDropped = incompleteTasks
    .filter((t) => t.dropped && t.droppedAt !== null && t.droppedAt >= since)
    .map((t) => ({
      taskId: String(t.id),
      name: t.name,
      projectId: t.projectId !== null ? String(t.projectId) : null,
      droppedAt: t.droppedAt!,
    }))
    .sort((a, b) => (b.droppedAt > a.droppedAt ? 1 : b.droppedAt < a.droppedAt ? -1 : 0));

  // ── tasksDeferred ─────────────────────────────────────────────────────────
  // Active tasks modified within the window that carry a deferDate.
  // Approximation: OF does not expose when a deferDate was set, so this uses
  // modifiedAt as a proxy — recently-modified tasks with a deferDate are likely
  // recently deferred. Treat as a heuristic, not an exact change log.
  const tasksDeferred = incompleteTasks
    .filter((t) => !t.dropped && t.deferDate !== null && t.modifiedAt >= since)
    .map((t) => ({
      taskId: String(t.id),
      name: t.name,
      projectId: t.projectId !== null ? String(t.projectId) : null,
      deferDate: t.deferDate!,
    }))
    .sort((a, b) => (b.deferDate > a.deferDate ? 1 : b.deferDate < a.deferDate ? -1 : 0));

  // ── projectsModified ──────────────────────────────────────────────────────
  // Projects modified within the window (approximation for status changes).
  const projectsModified = allProjects
    .filter((p) => p.modifiedAt >= since)
    .map((p) => ({
      projectId: String(p.id),
      name: p.name,
      status: p.status,
      modifiedAt: p.modifiedAt,
    }))
    .sort((a, b) => (b.modifiedAt > a.modifiedAt ? 1 : b.modifiedAt < a.modifiedAt ? -1 : 0));

  return {
    window: { hours, since },
    tasksCreated,
    tasksCompleted,
    tasksDropped,
    tasksDeferred,
    projectsModified,
    summary: {
      taskCreatedCount: tasksCreated.length,
      taskCompletedCount: tasksCompleted.length,
      taskDroppedCount: tasksDropped.length,
      taskDeferredCount: tasksDeferred.length,
      projectsAffected: projectsModified.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the `omnifocus://recent-activity{?hours}` resource.
 *
 * This resource is **safe to read on every session start** — it is designed
 * for context priming. Agents should call it before the first task-related
 * prompt so they walk into the conversation already oriented.
 */
export function registerRecentActivityResource(server: McpServer, adapter: OmniFocusAdapter): void {
  server.registerResource(
    "omnifocus-recent-activity",
    new ResourceTemplate(RECENT_ACTIVITY_URI_TEMPLATE, { list: undefined }),
    {
      description:
        "Session-priming activity feed for the last N hours (default 24, max 168). " +
        "Returns tasks created, completed, dropped, and deferred, plus projects modified. " +
        "Safe to read at every session start — designed for agent context priming. " +
        "All sections sorted by timestamp descending. Empty sections return [], never omitted. " +
        "Fidelity notes: tasksCreated includes active tasks only (completed-within-window appear in tasksCompleted); " +
        "tasksDeferred uses modifiedAt as a proxy (tasks modified in window with a deferDate set); " +
        "projectsModified includes any project modification, not status-change-only.",
      mimeType: "application/json",
    },
    async (_uri, variables) => {
      const hours = parseHours((variables as Record<string, string | undefined>).hours);
      const uri =
        hours === RECENT_ACTIVITY_DEFAULT_HOURS
          ? "omnifocus://recent-activity"
          : `omnifocus://recent-activity?hours=${hours}`;

      const payload = await buildRecentActivityPayload(adapter, hours);
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
