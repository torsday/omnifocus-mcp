/**
 * `omnifocus://stats` MCP resource — server-side aggregate counts.
 *
 * Every "how is my system doing?" query (weekly review, daily standup,
 * capacity planning) currently forces an agent to list every project, every
 * task, and tally on the client side. That burns thousands of tokens per ask
 * and the arithmetic is fragile (cache misses, partial pagination). This
 * resource computes the totals server-side and returns a fixed, lean shape.
 *
 * Cache: 60s TTL (read-heavy, computed via aggregation; freshness > 60s is
 * acceptable for a dashboard-style read). v1 caches as a single payload —
 * partition-key invalidation per category is a future optimization (see
 * follow-up issue).
 *
 * v1 implementation does the aggregation in TypeScript over existing adapter
 * methods (`listTasks`, `listProjects`, `listTags`, `getLastSync`). An OmniJS
 * aggregation script is roughly an order of magnitude faster on whole-DB
 * counts and is a documented future optimization (see #464 Technical Notes).
 *
 * @see #464 — initial implementation
 * @see DESIGN.md "Stalled project" definition
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import type { Project } from "../domain/project.js";
import type { Task } from "../domain/task.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STATS_URI = "omnifocus://stats";

/**
 * A project is "stalled" when ALL of the following hold:
 *   1. status === "active"
 *   2. ≥ STALLED_DAYS days since the latest task activity in the project
 *   3. no defer date in the future (a deferred project isn't stalled —
 *      it's deliberately paused)
 *
 * "Latest task activity" = max(task.modifiedAt) over the project's tasks,
 * or the project's own modifiedAt if it has no tasks.
 *
 * Same definition is used by `omnifocus://project-health` (#468). Keep them
 * in sync — single source of truth lives here in `isProjectStalled`.
 */
export const STALLED_DAYS = 14;

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface StatsPayload {
  tasks: {
    total: number;
    available: number;
    blocked: number;
    deferred: number;
    completed_today: number;
    completed_this_week: number;
    overdue_count: number;
    flagged_count: number;
    dropped_today: number;
  };
  projects: {
    total: number;
    active: number;
    on_hold: number;
    completed: number;
    dropped: number;
    stalled_count: number;
    due_for_review_count: number;
  };
  inbox: {
    count: number;
    /** `null` when the inbox is empty. Else floor(now - oldest.createdAt) in days, ≥ 0. */
    oldest_age_days: number | null;
  };
  tags: {
    total: number;
    with_tasks_count: number;
  };
  database: {
    /** `null` when the OF database has never synced. Else floor(now - lastSyncAt) in seconds, ≥ 0. */
    sync_age_seconds: number | null;
    last_sync_at: string | null;
  };
}

// ---------------------------------------------------------------------------
// Stalled-project predicate (exported so #468 can share)
// ---------------------------------------------------------------------------

/**
 * Determines whether a project is stalled per the canonical definition
 * (see `STALLED_DAYS` JSDoc above).
 *
 * `latestActivityAt` is the max of all task `modifiedAt` for tasks belonging
 * to this project, or `null` if the project has no tasks (in which case the
 * caller should pass the project's own `modifiedAt`).
 */
export function isProjectStalled(
  project: Project,
  latestActivityAt: string | null,
  now: Date,
): boolean {
  if (project.status !== "active") return false;
  if (project.completed || project.dropped) return false;

  // Deferred-into-the-future projects are deliberately paused, not stalled.
  if (project.deferDate) {
    const deferAt = new Date(project.deferDate);
    if (deferAt.getTime() > now.getTime()) return false;
  }

  const referenceIso = latestActivityAt ?? project.modifiedAt;
  const referenceMs = new Date(referenceIso).getTime();
  const ageMs = now.getTime() - referenceMs;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);

  return ageDays >= STALLED_DAYS;
}

// ---------------------------------------------------------------------------
// Helpers — pure, exported for testing
// ---------------------------------------------------------------------------

/** ISO-8601 string for the start of "today" in local time. */
function startOfTodayIso(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return d.toISOString();
}

/** ISO-8601 string for the start of "this week" (Monday 00:00 local). */
function startOfThisWeekIso(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  // ISO-week-style: Monday is the start of the week. JS getDay returns 0=Sun..6=Sat.
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Sunday rolls back six days; otherwise to Monday.
  d.setDate(d.getDate() + diff);
  return d.toISOString();
}

/** Group tasks by `projectId` for cheap per-project max-modifiedAt lookups. */
function groupTasksByProject(tasks: readonly Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.projectId) continue;
    const key = String(t.projectId);
    const list = map.get(key);
    if (list) list.push(t);
    else map.set(key, [t]);
  }
  return map;
}

/** Max ISO-8601 date string from a non-empty list, else `null`. */
function maxIso(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  let max = values[0] ?? null;
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (v && (max === null || v > max)) max = v;
  }
  return max;
}

// ---------------------------------------------------------------------------
// Builder — pure, `now` injectable for tests
// ---------------------------------------------------------------------------

/**
 * Compute the stats payload from the adapter's listing methods.
 *
 * Eight adapter calls in total:
 * - one `listTasks({})` (all tasks; the bulk of the data)
 * - one `listTasks({ inbox: true })` for the inbox bucket
 * - one `listProjects()` (all projects)
 * - one `listProjectsDueForReview()`
 * - one `listTags()` (all tags)
 * - one `getLastSync()`
 *
 * The "all tasks" read carries availability, completion, defer, due, drop,
 * and flag fields, so most counts derive from it without further calls.
 */
export async function buildStatsPayload(
  adapter: OmniFocusAdapter,
  now: Date = new Date(),
): Promise<StatsPayload> {
  const [allTasks, inboxTasks, allProjects, projectsDueForReview, allTags, sync] =
    await Promise.all([
      adapter.listTasks({}),
      adapter.listTasks({ inbox: true, completed: false }),
      adapter.listProjects(),
      adapter.listProjectsDueForReview(),
      adapter.listTags(),
      adapter.getLastSync(),
    ]);

  const todayStartIso = startOfTodayIso(now);
  const weekStartIso = startOfThisWeekIso(now);
  const nowIso = now.toISOString();

  // ── tasks ──────────────────────────────────────────────────────────────
  let tTotal = 0;
  let tAvailable = 0;
  let tBlocked = 0;
  let tDeferred = 0;
  let tCompletedToday = 0;
  let tCompletedThisWeek = 0;
  let tOverdue = 0;
  let tFlagged = 0;
  let tDroppedToday = 0;

  for (const task of allTasks) {
    tTotal += 1;
    if (task.completed) {
      if (task.completedAt) {
        if (task.completedAt >= weekStartIso) tCompletedThisWeek += 1;
        if (task.completedAt >= todayStartIso) tCompletedToday += 1;
      }
      continue; // remaining metrics are about not-yet-completed work
    }
    if (task.dropped) {
      if (task.droppedAt && task.droppedAt >= todayStartIso) tDroppedToday += 1;
      continue;
    }
    if (task.available) tAvailable += 1;
    if (task.blocked) tBlocked += 1;
    if (task.flagged) tFlagged += 1;
    if (task.deferDate && task.deferDate > nowIso) tDeferred += 1;
    if (task.dueDate && task.dueDate < nowIso) tOverdue += 1;
  }

  // ── projects ───────────────────────────────────────────────────────────
  let pActive = 0;
  let pOnHold = 0;
  let pCompleted = 0;
  let pDropped = 0;

  const tasksByProject = groupTasksByProject(allTasks);

  let pStalled = 0;
  for (const project of allProjects) {
    if (project.status === "active" && !project.completed && !project.dropped) pActive += 1;
    if (project.status === "on-hold") pOnHold += 1;
    if (project.completed || project.status === "done") pCompleted += 1;
    if (project.dropped || project.status === "dropped") pDropped += 1;

    const projectTasks = tasksByProject.get(String(project.id)) ?? [];
    const latestActivity = maxIso(projectTasks.map((t) => t.modifiedAt));
    if (isProjectStalled(project, latestActivity, now)) pStalled += 1;
  }

  // ── inbox ──────────────────────────────────────────────────────────────
  let oldestAgeDays: number | null = null;
  if (inboxTasks.length > 0) {
    const oldestCreatedIso = inboxTasks
      .map((t) => t.createdAt)
      .reduce((min, c) => (c < min ? c : min));
    const ageMs = now.getTime() - new Date(oldestCreatedIso).getTime();
    oldestAgeDays = Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
  }

  // ── tags ───────────────────────────────────────────────────────────────
  // Count tags referenced by ≥1 task in the database. Derived from task
  // listings rather than `tag.taskCount` because adapter implementations
  // (notably InMemoryAdapter) don't all maintain that field on writes.
  const tagsInUse = new Set<string>();
  for (const task of allTasks) {
    for (const tagId of task.tagIds) {
      tagsInUse.add(String(tagId));
    }
  }
  const tagsWithTasks = tagsInUse.size;

  // ── database ───────────────────────────────────────────────────────────
  let syncAgeSeconds: number | null = null;
  if (sync.lastSyncAt) {
    const ageMs = now.getTime() - new Date(sync.lastSyncAt).getTime();
    syncAgeSeconds = Math.max(0, Math.floor(ageMs / 1000));
  }

  return {
    tasks: {
      total: tTotal,
      available: tAvailable,
      blocked: tBlocked,
      deferred: tDeferred,
      completed_today: tCompletedToday,
      completed_this_week: tCompletedThisWeek,
      overdue_count: tOverdue,
      flagged_count: tFlagged,
      dropped_today: tDroppedToday,
    },
    projects: {
      total: allProjects.length,
      active: pActive,
      on_hold: pOnHold,
      completed: pCompleted,
      dropped: pDropped,
      stalled_count: pStalled,
      due_for_review_count: projectsDueForReview.length,
    },
    inbox: {
      count: inboxTasks.length,
      oldest_age_days: oldestAgeDays,
    },
    tags: {
      total: allTags.length,
      with_tasks_count: tagsWithTasks,
    },
    database: {
      sync_age_seconds: syncAgeSeconds,
      last_sync_at: sync.lastSyncAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerStatsResource(server: McpServer, adapter: OmniFocusAdapter): void {
  server.registerResource(
    "omnifocus-stats",
    STATS_URI,
    {
      description:
        "Server-side aggregate counts for the OmniFocus database — tasks, projects, inbox, tags, sync. " +
        "Use for 'how is my system doing?' queries (weekly review, daily standup, capacity planning) instead of " +
        "listing every task and tallying client-side. " +
        "Returns tasks { total, available, blocked, deferred, completed_today, completed_this_week, " +
        "overdue_count, flagged_count, dropped_today }, projects { total, active, on_hold, completed, dropped, " +
        "stalled_count, due_for_review_count }, inbox { count, oldest_age_days }, tags { total, with_tasks_count }, " +
        "database { sync_age_seconds, last_sync_at }. " +
        "Stalled = active project with ≥ 14 days since last task activity and no future defer date. " +
        "Read-only.",
      mimeType: "application/json",
    },
    async (_uri) => {
      const payload = await buildStatsPayload(adapter);
      return {
        contents: [
          {
            uri: STATS_URI,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );
}
