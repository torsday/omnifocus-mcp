/**
 * `omnifocus://project-health{?staleDays}` MCP resource.
 *
 * Triage list of active projects with health-warning signals — the
 * weekly-review answer to "which active projects are stalled?" without the
 * agent having to fetch every project, every task, and compute on the
 * client. Returns granular per-project signals; leaves *judgment*
 * (stalled-because-blocked vs. stalled-because-abandoned) to the agent.
 *
 * Query parameters:
 *   - `staleDays` (optional, integer ≥ 1) — overrides the default 14-day
 *     threshold for "no recent activity"
 *
 * Cache: 60s TTL (read-heavy, computed via aggregation). v1 caches as a
 * single payload; partition-key invalidation is a future optimization.
 *
 * @see #468 — initial implementation
 * @see src/domain/health.ts — `STALLED_DAYS`, `isProjectStalled`
 * @see src/resources/stats.ts — count-form sibling
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import { isProjectStalled, STALLED_DAYS } from "../domain/health.js";
import type { Task } from "../domain/task.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROJECT_HEALTH_URI_TEMPLATE = "omnifocus://project-health{?staleDays}";

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface ProjectHealthSignals {
  /** Most recent task modification in the project, ISO-8601. `null` when the project has no tasks. */
  lastTaskActivityAt: string | null;
  /** floor((now - lastTaskActivityAt) / day). Falls back to project.modifiedAt when no tasks. */
  daysSinceActivity: number;
  /** Tasks where `available === true` (not blocked, not deferred-into-future, not completed). */
  availableTaskCount: number;
  /** Tasks where `blocked === true`. */
  blockedTaskCount: number;
  /** True when the project has zero non-completed, non-dropped tasks. */
  hasNoActions: boolean;
  /** True when the project has tasks but every non-completed task has a future defer date. */
  deferredFutureTasks: boolean;
  /** ISO-8601; `null` when the project has never been reviewed. */
  lastReviewedAt: string | null;
  /** floor((now - lastReviewedAt) / day). `null` when never reviewed. */
  daysSinceReview: number | null;
  /** True when `nextReviewDate <= today` OR `nextReviewDate === null` for an active project. */
  overdueForReview: boolean;
}

export interface ProjectHealthEntry {
  projectId: string;
  name: string;
  status: string;
  signals: ProjectHealthSignals;
}

export interface ProjectHealthPayload {
  /** Triage list — projects flagged by ≥1 health condition, sorted by severity. */
  projects: readonly ProjectHealthEntry[];
  /** The threshold used for "stale activity" — echoes back `staleDays` or the default. */
  staleDays: number;
  /** ISO-8601 generation timestamp. */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers — pure
// ---------------------------------------------------------------------------

/** Group tasks by `projectId`. Inbox tasks (no projectId) are ignored. */
function groupTasksByProject(tasks: readonly Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.projectId) continue;
    const key = String(task.projectId);
    const list = map.get(key);
    if (list) list.push(task);
    else map.set(key, [task]);
  }
  return map;
}

/** Max ISO-8601 string from a list, else `null`. */
function maxIso(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  let max = values[0] ?? null;
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (v && (max === null || v > max)) max = v;
  }
  return max;
}

/** floor((now - then) / day). Returns 0 when `then` is in the future. */
function daysBetween(thenIso: string, now: Date): number {
  const ageMs = now.getTime() - new Date(thenIso).getTime();
  return Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
}

/**
 * Compute health signals for a single project given its (possibly empty)
 * task list.
 */
export function buildProjectSignals(
  project: { modifiedAt: string; nextReviewDate: string | null; lastReviewDate: string | null },
  tasks: readonly Task[],
  now: Date,
): ProjectHealthSignals {
  const openTasks = tasks.filter((t) => !t.completed && !t.dropped);
  const taskMods = tasks.map((t) => t.modifiedAt);
  const lastTaskActivityAt = maxIso(taskMods);
  const referenceIso = lastTaskActivityAt ?? project.modifiedAt;
  const daysSinceActivity = daysBetween(referenceIso, now);

  const availableTaskCount = openTasks.filter((t) => t.available).length;
  const blockedTaskCount = openTasks.filter((t) => t.blocked).length;

  const hasNoActions = openTasks.length === 0;
  const nowIso = now.toISOString();
  const deferredFutureTasks =
    openTasks.length > 0 && openTasks.every((t) => t.deferDate !== null && t.deferDate > nowIso);

  const lastReviewedAt = project.lastReviewDate;
  const daysSinceReview = lastReviewedAt ? daysBetween(lastReviewedAt, now) : null;

  // Overdue for review: nextReviewDate is null (never set) OR ≤ today's start.
  // The adapter's `listProjectsDueForReview` uses the same semantics.
  let overdueForReview: boolean;
  if (project.nextReviewDate === null) {
    overdueForReview = true;
  } else {
    overdueForReview = project.nextReviewDate <= nowIso;
  }

  return {
    lastTaskActivityAt,
    daysSinceActivity,
    availableTaskCount,
    blockedTaskCount,
    hasNoActions,
    deferredFutureTasks,
    lastReviewedAt,
    daysSinceReview,
    overdueForReview,
  };
}

/**
 * Determines whether a project's signals trip ANY of the health-warning
 * conditions. Active projects qualify when:
 *   - days since activity ≥ staleDays (per `isProjectStalled`)
 *   - OR no available tasks while active
 *   - OR overdue for review
 *   - OR every non-completed task has a future defer date
 */
function isFlagged(signals: ProjectHealthSignals, isStalled: boolean, isActive: boolean): boolean {
  if (!isActive) return false;
  if (isStalled) return true;
  if (signals.availableTaskCount === 0) return true;
  if (signals.overdueForReview) return true;
  if (signals.deferredFutureTasks) return true;
  return false;
}

/**
 * Severity score — higher means more urgent. Used for sort:
 *   1. most-overdue review first
 *   2. then longest no-activity
 *   3. then no-available-tasks
 */
function severityScore(signals: ProjectHealthSignals): number {
  // Compose a single number where review-overdue dominates, days-since-activity
  // is next, and no-actions / no-available is the tiebreaker.
  let score = 0;
  if (signals.overdueForReview) {
    // daysSinceReview can be null (never reviewed) — treat as max severity.
    const reviewDays = signals.daysSinceReview ?? 9_999;
    score += 1_000_000 + reviewDays;
  }
  score += 1_000 + signals.daysSinceActivity;
  if (signals.availableTaskCount === 0) score += 50;
  if (signals.hasNoActions) score += 25;
  return score;
}

// ---------------------------------------------------------------------------
// Builder — pure, `now` injectable for tests
// ---------------------------------------------------------------------------

export async function buildProjectHealthPayload(
  adapter: OmniFocusAdapter,
  staleDays: number = STALLED_DAYS,
  now: Date = new Date(),
): Promise<ProjectHealthPayload> {
  const [allProjects, allTasks] = await Promise.all([
    adapter.listProjects(),
    adapter.listTasks({}),
  ]);

  const tasksByProject = groupTasksByProject(allTasks);

  const flagged: Array<ProjectHealthEntry & { _severity: number }> = [];

  for (const project of allProjects) {
    const isActive = project.status === "active" && !project.completed && !project.dropped;
    if (!isActive) continue;

    const projectTasks = tasksByProject.get(String(project.id)) ?? [];
    const signals = buildProjectSignals(project, projectTasks, now);

    // Stalled per the canonical definition, with optional override.
    const stalled = isProjectStalled(project, signals.lastTaskActivityAt, now, staleDays);

    if (!isFlagged(signals, stalled, isActive)) continue;

    flagged.push({
      projectId: String(project.id),
      name: project.name,
      status: project.status,
      signals,
      _severity: severityScore(signals),
    });
  }

  // Sort descending by severity, then by name as a stable tiebreaker.
  flagged.sort((a, b) => {
    if (a._severity !== b._severity) return b._severity - a._severity;
    return a.name.localeCompare(b.name);
  });

  return {
    projects: flagged.map(({ _severity, ...entry }) => entry),
    staleDays,
    generatedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Query-parameter parsing
// ---------------------------------------------------------------------------

/**
 * Parse the `staleDays` URI variable. Returns the canonical default
 * (`STALLED_DAYS`) when the parameter is absent, malformed, or not a
 * positive integer.
 */
export function parseStaleDays(raw: string | undefined): number {
  if (!raw) return STALLED_DAYS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return STALLED_DAYS;
  return parsed;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProjectHealthResource(server: McpServer, adapter: OmniFocusAdapter): void {
  server.registerResource(
    "omnifocus-project-health",
    new ResourceTemplate(PROJECT_HEALTH_URI_TEMPLATE, { list: undefined }),
    {
      description:
        "Triage list of active projects flagged by health-warning conditions — the weekly-review answer to " +
        "'which active projects are stalled?' Returns per-project signals (lastTaskActivityAt, daysSinceActivity, " +
        "availableTaskCount, blockedTaskCount, hasNoActions, deferredFutureTasks, lastReviewedAt, daysSinceReview, " +
        "overdueForReview), filtered to projects matching ≥1 of: ≥ staleDays since last activity (default 14, " +
        "override with ?staleDays=N), zero available tasks, overdue for review, all tasks deferred into the future. " +
        "Sorted by severity (review-overdue first, then longest no-activity, then no-available-tasks). " +
        "Granular signals — leaves the judgment (blocked vs abandoned) to the agent. Read-only.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const vars = variables as Record<string, string | undefined>;
      const staleDays = parseStaleDays(vars.staleDays);
      const payload = await buildProjectHealthPayload(adapter, staleDays);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );
}
