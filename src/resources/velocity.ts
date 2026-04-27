/**
 * `omnifocus://velocity` MCP resource.
 *
 * Rolling completion/creation/drop velocity over configurable trailing weeks.
 * Answers "am I getting better or worse?" as a complement to the retrospective
 * (per-week snapshot) and burndown (per-project trajectory).
 *
 * URI: `omnifocus://velocity{?weeks}`
 *   - `weeks` (optional, default 8, max 52): number of trailing weeks to include
 *
 * Payload shape:
 *   {
 *     window:          { from: string; to: string }
 *     weeklyTotals:    { weekStart: string; created: number; completed: number;
 *                        dropped: number; netDelta: number }[]
 *     rollingAverages: { window: 4 | 8;
 *                        completedPerWeek: number; createdPerWeek: number }[]
 *     topClosingProjects: { projectId: string; name: string;
 *                           closedThisWeek: number; closedTrailing4: number }[]
 *   }
 *
 * Notes:
 * - `netDelta` = created − completed − dropped (positive = backlog growing)
 * - `topClosingProjects` reports top-5 projects by `closedThisWeek` (then
 *   by `closedTrailing4` as tiebreaker). "This week" = the most recent week
 *   in the requested range.
 * - Rolling averages are computed only for windows ≤ requested weeks; if
 *   `weeks < 8` the 8-week average is omitted.
 * - Cached by the adapter-level LRU; no per-resource TTL override here
 *   (see docs/adr/0006-read-cache-strategy.md). Historical task data
 *   changes only when mutations occur, so invalidation covers freshness.
 *
 * @see #480
 * @see src/resources/retrospective.ts — per-range sibling
 * @see src/resources/burndown.ts — per-project trajectory
 * @see src/domain/calendarWeeks.ts — week-boundary helpers
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import { isoWeekEnd, isoWeekStart, trailingWeekStarts } from "../domain/calendarWeeks.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VELOCITY_URI_TEMPLATE = "omnifocus://velocity{?weeks}";

export const VELOCITY_DEFAULT_WEEKS = 8;
export const VELOCITY_MAX_WEEKS = 52;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeeklyTotal {
  weekStart: string;
  created: number;
  completed: number;
  dropped: number;
  /** created − completed − dropped; positive = backlog growing */
  netDelta: number;
}

export interface RollingAverage {
  window: 4 | 8;
  completedPerWeek: number;
  createdPerWeek: number;
}

export interface TopClosingProject {
  projectId: string;
  name: string;
  closedThisWeek: number;
  closedTrailing4: number;
}

export interface VelocityPayload {
  window: { from: string; to: string };
  weeklyTotals: WeeklyTotal[];
  rollingAverages: RollingAverage[];
  topClosingProjects: TopClosingProject[];
}

// ---------------------------------------------------------------------------
// Helpers — pure, exported for testing
// ---------------------------------------------------------------------------

/**
 * Parse the `weeks` URI variable. Returns a clamped integer in [1, VELOCITY_MAX_WEEKS].
 * Defaults to VELOCITY_DEFAULT_WEEKS when the value is absent, non-numeric, or ≤ 0.
 */
export function parseWeeks(raw: string | undefined): number {
  if (raw === undefined || raw === null || raw === "") return VELOCITY_DEFAULT_WEEKS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return VELOCITY_DEFAULT_WEEKS;
  return Math.min(VELOCITY_MAX_WEEKS, Math.max(1, Math.round(n)));
}

/**
 * Compute velocity payload from adapter data.
 *
 * Exported separately so unit tests can inject a mock adapter without
 * spinning up an MCP server.
 */
export async function buildVelocityPayload(
  adapter: OmniFocusAdapter,
  weeks: number,
  now: Date = new Date(),
): Promise<VelocityPayload> {
  // ── Determine time window ──────────────────────────────────────────────
  const weekStarts = trailingWeekStarts(weeks, now);
  // trailingWeekStarts always returns exactly `weeks` elements for weeks >= 1.
  const windowFrom = weekStarts[0] as Date; // oldest Monday
  // windowTo = exclusive end of the most recent week
  const lastWeekStart = weekStarts[weekStarts.length - 1] as Date;
  const windowTo = isoWeekEnd(lastWeekStart);

  const windowFromIso = windowFrom.toISOString();
  const windowToIso = windowTo.toISOString();

  // ── Fetch data ─────────────────────────────────────────────────────────
  // Three parallel fetches:
  //  - incomplete tasks (includes dropped) — for created + dropped counts
  //  - completed tasks since windowFrom — for completed counts
  //  - projects — for topClosingProjects
  const [incompleteTasks, completedTasks, projects] = await Promise.all([
    adapter.listTasks({ completed: false }),
    adapter.listTasks({ completed: true, completedSince: windowFromIso }),
    adapter.listProjects(),
  ]);

  // Build a project name lookup
  const projectNames = new Map<string, string>();
  for (const p of projects) {
    projectNames.set(String(p.id), p.name);
  }

  // ── Per-week bucketing ─────────────────────────────────────────────────
  // For each week, count tasks whose relevant timestamp falls in [weekStart, weekEnd).

  const weeklyTotals: WeeklyTotal[] = weekStarts.map((weekStart) => {
    const weekEnd = isoWeekEnd(weekStart);
    const weekStartIso = weekStart.toISOString();
    const weekEndIso = weekEnd.toISOString();

    // created: tasks whose createdAt falls in this week
    const created = incompleteTasks.filter(
      (t) => t.createdAt >= weekStartIso && t.createdAt < weekEndIso,
    ).length;

    // completed: tasks whose completedAt falls in this week
    // (completedTasks only contains tasks completed since windowFrom; we
    //  filter to this specific week using completedAt)
    const completed = completedTasks.filter(
      (t) => t.completedAt !== null && t.completedAt >= weekStartIso && t.completedAt < weekEndIso,
    ).length;

    // Also count completed tasks that were created before windowFrom but
    // completed in this week (completedTasks has all completedSince windowFrom)
    // The above already handles this since completedTasks includes all tasks
    // completed since windowFrom regardless of creation date.

    // dropped: tasks whose droppedAt falls in this week
    const dropped = incompleteTasks.filter(
      (t) =>
        t.dropped &&
        t.droppedAt !== null &&
        t.droppedAt >= weekStartIso &&
        t.droppedAt < weekEndIso,
    ).length;

    return {
      weekStart: weekStartIso,
      created,
      completed,
      dropped,
      netDelta: created - completed - dropped,
    };
  });

  // ── Rolling averages ───────────────────────────────────────────────────
  const rollingAverages: RollingAverage[] = [];

  for (const windowSize of [4, 8] as const) {
    if (weeks < windowSize) continue;
    const slice = weeklyTotals.slice(-windowSize);
    const totalCompleted = slice.reduce((s, w) => s + w.completed, 0);
    const totalCreated = slice.reduce((s, w) => s + w.created, 0);
    rollingAverages.push({
      window: windowSize,
      completedPerWeek: Math.round((totalCompleted / windowSize) * 100) / 100,
      createdPerWeek: Math.round((totalCreated / windowSize) * 100) / 100,
    });
  }

  // ── Top closing projects ───────────────────────────────────────────────
  // "Closing" = tasks completed in project. "This week" = most recent week.
  // "Trailing 4" = last 4 weeks (or all weeks if fewer).
  const thisWeekStart = isoWeekStart(lastWeekStart).toISOString();
  const thisWeekEnd = isoWeekEnd(lastWeekStart).toISOString();

  const trailing4Start = (weekStarts[Math.max(0, weekStarts.length - 4)] as Date).toISOString();

  // Count completions per project per window
  const completedThisWeekByProject = new Map<string, number>();
  const completedTrailing4ByProject = new Map<string, number>();

  for (const t of completedTasks) {
    if (t.completedAt === null || t.projectId === null) continue;
    const pid = String(t.projectId);

    if (t.completedAt >= thisWeekStart && t.completedAt < thisWeekEnd) {
      completedThisWeekByProject.set(pid, (completedThisWeekByProject.get(pid) ?? 0) + 1);
    }
    if (t.completedAt >= trailing4Start && t.completedAt < windowToIso) {
      completedTrailing4ByProject.set(pid, (completedTrailing4ByProject.get(pid) ?? 0) + 1);
    }
  }

  // Combine and sort: primary by closedThisWeek desc, secondary by closedTrailing4 desc
  const allProjectIds = new Set([
    ...completedThisWeekByProject.keys(),
    ...completedTrailing4ByProject.keys(),
  ]);

  const topClosingProjects: TopClosingProject[] = Array.from(allProjectIds)
    .map((pid) => ({
      projectId: pid,
      name: projectNames.get(pid) ?? pid,
      closedThisWeek: completedThisWeekByProject.get(pid) ?? 0,
      closedTrailing4: completedTrailing4ByProject.get(pid) ?? 0,
    }))
    .sort((a, b) =>
      b.closedThisWeek !== a.closedThisWeek
        ? b.closedThisWeek - a.closedThisWeek
        : b.closedTrailing4 - a.closedTrailing4,
    )
    .slice(0, 5);

  return {
    window: { from: windowFromIso, to: windowToIso },
    weeklyTotals,
    rollingAverages,
    topClosingProjects,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerVelocityResource(server: McpServer, adapter: OmniFocusAdapter): void {
  server.registerResource(
    "omnifocus-velocity",
    new ResourceTemplate(VELOCITY_URI_TEMPLATE, { list: undefined }),
    {
      description:
        "Rolling task velocity over trailing weeks — created, completed, dropped, and net-delta per week, " +
        "plus rolling 4-week and 8-week completion/creation averages and the top-5 highest-closing projects. " +
        "Default window: 8 weeks; max: 52 weeks. " +
        "Use to answer 'am I getting better or worse?' alongside omnifocus://retrospective (per-range) and omnifocus://burndown/{projectId} (per-project). " +
        "Read-only.",
      mimeType: "application/json",
    },
    async (_uri, variables) => {
      const vars = variables as Record<string, string | undefined>;
      const weeks = parseWeeks(vars.weeks);
      const payload = await buildVelocityPayload(adapter, weeks);

      const uri = `omnifocus://velocity?weeks=${weeks}`;
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
