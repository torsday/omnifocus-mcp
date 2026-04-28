/**
 * `forecast_pack` MCP tool — time-budget reconciliation over forecast tasks.
 *
 * Takes a budget (in minutes) and an optional tag filter, then greedily
 * selects tasks from the user's forecast that fit. Tasks without
 * `estimatedMinutes` are surfaced under `skipped.no-estimate` so the agent
 * can prompt the user rather than silently dropping them.
 *
 * Greedy is deliberate over knapsack: a knapsack solver gives marginally
 * better packings (≤ a few minutes) and dramatically worse explanations.
 * Users want to TRUST the picks; predictability beats optimality here.
 *
 * @see #473
 * @see DESIGN.md §12 — response envelope
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TagId } from "../../domain/ids.js";
import type { Task } from "../../domain/task.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ForecastService } from "../../services/forecastService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const FORECAST_PACK_DESCRIPTION =
  "Pack today's forecast tasks into a time budget. " +
  "Use when the user asks 'I have N hours; what should I do?' or wants a focused subset of forecast tasks that fit a limited window. " +
  "Do NOT use for the full forecast — prefer forecast_get for that. " +
  "Do NOT use to schedule work across multiple days — pass scope='next7' as a hint, but the pack is still budget-bounded; for true multi-day planning use forecast_get with days>1 and let the agent compose. " +
  "Pass budgetMinutes (1–1440) and optional filter { tagIds?, scope? }; scope is 'today' (default) or 'next7'. " +
  "Returns { selected[], totalMinutes, skipped[] }. selected[] are the picks in execution order (flagged first, then dueDate ascending, then stable by ID). " +
  "skipped[] surfaces tasks the agent should ask the user about: { reason: 'no-estimate' } means the task has no estimatedMinutes so couldn't be packed; { reason: 'exceeds-budget' } means it would have fit individually but was bumped by earlier higher-priority picks. " +
  "Read-only; no side effects; safe to retry. Pack algorithm is greedy — predictable and explainable beats optimal-by-1-minute. " +
  "Example: forecast_pack({ budgetMinutes: 120 }) " +
  'Example: forecast_pack({ budgetMinutes: 240, filter: { tagIds: ["tag123"], scope: "today" } })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const forecastPackInputSchema = z.object({
  budgetMinutes: z
    .number()
    .int()
    .min(1)
    .max(1440)
    .describe(
      "Time budget in minutes (1–1440 — i.e. up to 24 hours). " +
        "Selected tasks' estimatedMinutes will sum to ≤ this value.",
    ),
  filter: z
    .object({
      tagIds: z
        .array(TagId.schema)
        .optional()
        .describe(
          "Restrict to tasks bearing at least one of these tag IDs. " +
            "Empty array or omitted means no tag filter.",
        ),
      scope: z
        .enum(["today", "next7"])
        .optional()
        .default("today")
        .describe(
          "Forecast horizon to pack from: 'today' (overdue + dueToday + flagged) " +
            "or 'next7' (everything in the next 7 days). Default 'today'.",
        ),
    })
    .optional()
    .describe("Optional filter narrowing the candidate set before packing."),
});

export type ForecastPackToolInput = z.infer<typeof forecastPackInputSchema>;

// ---------------------------------------------------------------------------
// Skip reason taxonomy
// ---------------------------------------------------------------------------

export type SkipReason = "no-estimate" | "exceeds-budget";

export interface SkippedTask {
  taskId: string;
  name: string;
  estimatedMinutes: number | null;
  reason: SkipReason;
}

export interface SelectedTask {
  taskId: string;
  name: string;
  estimatedMinutes: number;
  flagged: boolean;
  dueDate: string | null;
}

export interface ForecastPackResult {
  selected: SelectedTask[];
  totalMinutes: number;
  skipped: SkippedTask[];
}

// ---------------------------------------------------------------------------
// Pack algorithm — pure, exported for testing
// ---------------------------------------------------------------------------

/**
 * Sort key for deterministic pack ordering:
 *   1. Flagged tasks before unflagged.
 *   2. Tasks with earlier dueDate before later (or null due-date).
 *   3. Stable tiebreak by task ID (so identical inputs yield identical output).
 *
 * Returns negative if `a` should sort before `b`, positive if after, 0 if equal.
 */
export function packCompareTasks(a: Task, b: Task): number {
  // 1. Flagged first
  if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;

  // 2. Earlier dueDate first; null due-date sorts last within the flagged tier
  const aDue = a.dueDate;
  const bDue = b.dueDate;
  if (aDue !== bDue) {
    if (aDue === null) return 1;
    if (bDue === null) return -1;
    if (aDue < bDue) return -1;
    if (aDue > bDue) return 1;
  }

  // 3. Stable: by ID
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Greedy time-budget pack. Pure function — no I/O, fully deterministic.
 *
 * Tasks are sorted by {@link packCompareTasks}, then walked in order. Each
 * task with an `estimatedMinutes` that fits the remaining budget is selected;
 * each that doesn't fit is added to `skipped` with `reason: 'exceeds-budget'`.
 * Tasks without `estimatedMinutes` are added to `skipped` with `reason:
 * 'no-estimate'` regardless of budget — the agent should ask the user.
 *
 * Filter (if any) is applied here, not by the caller, so the skip taxonomy
 * doesn't leak filtered-out tasks (which aren't candidates and shouldn't
 * appear in `skipped`).
 */
export function pack(
  candidates: Task[],
  budgetMinutes: number,
  filter?: { tagIds?: readonly string[] | undefined },
): ForecastPackResult {
  // Apply filter first — filtered-out tasks are not candidates, not skips
  const filterTagIds = filter?.tagIds;
  const filtered =
    filterTagIds && filterTagIds.length > 0
      ? candidates.filter((t) => t.tagIds.some((tid) => filterTagIds.includes(tid)))
      : candidates;

  // Stable sort by canonical key
  const sorted = [...filtered].sort(packCompareTasks);

  const selected: SelectedTask[] = [];
  const skipped: SkippedTask[] = [];
  let totalMinutes = 0;

  for (const task of sorted) {
    if (task.estimatedMinutes === null) {
      skipped.push({
        taskId: task.id,
        name: task.name,
        estimatedMinutes: null,
        reason: "no-estimate",
      });
      continue;
    }
    if (totalMinutes + task.estimatedMinutes <= budgetMinutes) {
      selected.push({
        taskId: task.id,
        name: task.name,
        estimatedMinutes: task.estimatedMinutes,
        flagged: task.flagged,
        dueDate: task.dueDate,
      });
      totalMinutes += task.estimatedMinutes;
    } else {
      skipped.push({
        taskId: task.id,
        name: task.name,
        estimatedMinutes: task.estimatedMinutes,
        reason: "exceeds-budget",
      });
    }
  }

  return { selected, totalMinutes, skipped };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ForecastPackContext {
  forecastService: ForecastService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Resolve `scope` to a `{ from, to }` ISO-8601 range.
 *   - 'today': start of today through end of today (local)
 *   - 'next7': start of today through end of today + 6 days (7-day window)
 */
function resolveScopeRange(scope: "today" | "next7"): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + (scope === "next7" ? 6 : 0));
  to.setHours(23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * Deduplicate forecast buckets into a single candidate list.
 *
 * `forecast_get` returns overdue / dueToday / deferredToday / flagged as
 * separate arrays; the same task can appear in multiple (e.g. flagged AND
 * dueToday). Pack treats them as one set, ordered by the canonical key.
 */
function collectCandidates(forecast: {
  overdue: Task[];
  dueToday: Task[];
  deferredToday: Task[];
  flagged: Task[];
}): Task[] {
  const seen = new Set<string>();
  const out: Task[] = [];
  for (const bucket of [
    forecast.overdue,
    forecast.dueToday,
    forecast.deferredToday,
    forecast.flagged,
  ]) {
    for (const task of bucket) {
      if (!seen.has(task.id)) {
        seen.add(task.id);
        out.push(task);
      }
    }
  }
  return out;
}

export async function handleForecastPack(input: ForecastPackToolInput, ctx: ForecastPackContext) {
  const scope = input.filter?.scope ?? "today";
  const { from, to } = resolveScopeRange(scope);

  const result = await ctx.forecastService.get({
    from,
    to,
    includeOverdue: true,
    includeDeferred: scope === "next7",
    includeFlagged: true,
  });

  const candidates = collectCandidates(result);
  const packed = pack(candidates, input.budgetMinutes, input.filter);

  const meta = ctx.makeMeta({ cacheHit: result.cacheHit });
  return ok(packed, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerForecastPackTool(server: McpServer, ctx: ForecastPackContext) {
  return server.registerTool(
    "forecast_pack",
    {
      description: FORECAST_PACK_DESCRIPTION,
      inputSchema: forecastPackInputSchema.shape,
    },
    async (args: ForecastPackToolInput) => {
      const envelope = await handleForecastPack(args, ctx);
      return toolResponse(envelope);
    },
  );
}
