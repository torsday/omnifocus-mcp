/**
 * `forecast_get` MCP tool — forecast-view tasks grouped by category.
 *
 * Returns overdue, due-today, deferred-today, and flagged tasks for a
 * caller-supplied date range. This is the primary "what's on my plate
 * today" read for LLM agents (SPEC §forecast).
 *
 * @see src/services/forecastService.ts
 * @see DESIGN.md §12 — response envelope
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  flexDateString,
  isIsoDateString,
  isRelativeDateShortcut,
  resolveRelativeDate,
} from "../../domain/dates.js";
import { TASK_FIELD_NAMES, TASK_FIELD_NAMES_SET, type Task } from "../../domain/task.js";
import {
  ok,
  type Pagination,
  type ResponseMeta,
  toolResponse,
  warnUnknownFields,
} from "../../envelope/index.js";
import { applyProjection, validateFields } from "../../envelope/projection.js";
import { ValidationError } from "../../errors/index.js";
import { decodeCursor, encodeCursor, hashFilter, isAfterCursor } from "../../pagination/cursor.js";
import type { ForecastService } from "../../services/forecastService.js";

/** Default page size when `limit` is omitted (matches `task_list` / `perspective_evaluate`). */
const DEFAULT_LIMIT = 50;
/** Hard ceiling per #966 — keeps a single forecast page within the envelope-size budget. */
const MAX_LIMIT = 200;

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const FORECAST_GET_DESCRIPTION =
  "Get forecast-view tasks from OmniFocus grouped by category: overdue, dueToday, deferredToday, flagged. " +
  "Use this for 'what's on my plate today' or multi-day planning queries. " +
  "Do NOT use to list all tasks across all projects; prefer task_list instead. " +
  "Supply date (ISO-8601 or shortcut like 'today', 'tomorrow') and days (1–7) for the ergonomic interface, " +
  "or use from/to for exact ISO-8601 ranges. " +
  "All include flags default to true; set to false to omit a category. " +
  "When days > 1, response also includes byDate[] grouping task IDs per calendar day (dereference from dueToday[]). " +
  "Returns { overdue[], dueToday[], deferredToday[], flagged[], byDate? } plus pagination { hasMore, cursor }; byDate entries are { date, taskIds[] }. " +
  "Pages span the union of all four buckets (a task in multiple buckets counts once); default 50 tasks per page (max 200). Safe to call repeatedly; no side effects. " +
  'Example: forecast_get({ date: "today" }) ' +
  'Example: forecast_get({ date: "today", days: 3, includeFlagged: false }) ' +
  'Example: forecast_get({ date: "today", limit: 25, cursor: "<prev-cursor>" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const forecastGetInputSchema = z.object({
  /**
   * Ergonomic single-day shorthand. Mutually exclusive with `from`/`to`.
   * Accepts ISO-8601 date strings or relative shortcuts (today, tomorrow, yesterday, …).
   */
  date: flexDateString()
    .optional()
    .describe(
      "Anchor date for the forecast (ISO-8601 or relative shortcut: today, tomorrow, yesterday, this-week, next-week). " +
        "Mutually exclusive with from/to. Defaults to today.",
    ),
  /**
   * Number of calendar days to cover, starting from `date` (or `from`).
   * When > 1, response includes `byDate[]` grouping per-day.
   */
  days: z
    .number()
    .int()
    .min(1)
    .max(7)
    .optional()
    .default(1)
    .describe(
      "Number of days to cover (1–7). Default 1. When > 1, byDate[] is included in the response.",
    ),
  from: flexDateString()
    .optional()
    .describe(
      "Start of date range (ISO-8601 or relative shortcut like 'today'). " +
        "Use date/days for the ergonomic interface instead. Defaults to start of today.",
    ),
  to: flexDateString()
    .optional()
    .describe(
      "End of date range (ISO-8601 or relative shortcut like 'today'). " +
        "Use date/days for the ergonomic interface instead. Defaults to end of today.",
    ),
  includeOverdue: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include tasks overdue before the start of the range. Default true."),
  includeDeferred: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include tasks whose defer date falls within the range. Default true."),
  includeFlagged: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include all flagged incomplete tasks. Default true."),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict each returned task (across overdue/dueToday/deferredToday/flagged/byDate) to this list of top-level fields (id is always returned). " +
        "Omit for the full task shape. Empty array returns just id. " +
        "Unknown names are dropped silently and surface in meta.warnings.WARN_UNKNOWN_FIELDS. " +
        `Allowed: ${TASK_FIELD_NAMES.join(", ")}.`,
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(
      `Max unique tasks per page (1..${MAX_LIMIT}). Default ${DEFAULT_LIMIT}. ` +
        "Pagination spans the union of overdue/dueToday/deferredToday/flagged: a task that appears in multiple buckets counts once. " +
        "Use `cursor` to fetch subsequent pages.",
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque cursor from a previous forecast_get response. " +
        "Must use the same filters (date/from/to/days/include* /fields) — changing filters mid-sequence returns a ValidationError.",
    ),
});

export type ForecastGetToolInput = z.infer<typeof forecastGetInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ForecastGetContext {
  forecastService: ForecastService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Resolve a date string (ISO-8601 or relative shortcut) to a JS Date at
 * the start of that local calendar day.
 */
function resolveAnchorDate(dateStr: string): Date {
  let iso: string;
  if (isRelativeDateShortcut(dateStr)) {
    iso = resolveRelativeDate(dateStr);
  } else if (isIsoDateString(dateStr)) {
    iso = dateStr;
  } else {
    throw new ValidationError(
      `Invalid date: "${dateStr}". Expected ISO-8601 or a relative shortcut.`,
      {
        details: { field: "date", value: dateStr },
      },
    );
  }
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Resolve input to an absolute `{ from, to }` ISO-8601 range.
 *
 * Priority:
 *   1. `date` + `days` — ergonomic interface
 *   2. `from` / `to` — explicit range (existing behaviour)
 *   3. Default: today
 *
 * Throws {@link ValidationError} when both `date` and `from`/`to` are supplied.
 */
function resolveRange(input: ForecastGetToolInput): { from: string; to: string; days: number } {
  const hasDateShorthand = input.date !== undefined;
  const hasExplicitRange = input.from !== undefined || input.to !== undefined;

  if (hasDateShorthand && hasExplicitRange) {
    throw new ValidationError("date and from/to are mutually exclusive — use one or the other.", {
      suggestion: "Remove from/to when using date, or remove date when using from/to.",
      details: { field: "date|from|to" },
    });
  }

  const days = input.days ?? 1;

  if (hasDateShorthand) {
    // Anchor to start of the supplied date, extend by `days`.
    const anchor = resolveAnchorDate(input.date as string);
    const end = new Date(anchor);
    end.setDate(end.getDate() + days - 1);
    end.setHours(23, 59, 59, 999);
    return { from: anchor.toISOString(), to: end.toISOString(), days };
  }

  if (hasExplicitRange) {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    return {
      from: input.from ?? startOfToday.toISOString(),
      to: input.to ?? endOfToday.toISOString(),
      days,
    };
  }

  // Default: today × days
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const end = new Date(startOfToday);
  end.setDate(end.getDate() + days - 1);
  end.setHours(23, 59, 59, 999);
  return { from: startOfToday.toISOString(), to: end.toISOString(), days };
}

/**
 * Group tasks by the calendar day (YYYY-MM-DD) of their `dueDate`.
 * Returns task IDs only — full Task objects already appear in the top-level
 * `dueToday` / `overdue` arrays, so repeating them here would duplicate bytes.
 * Tasks without a dueDate are omitted from the grouping.
 */
function groupByDate(tasks: Task[]): { date: string; taskIds: string[] }[] {
  const map = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const day = task.dueDate.slice(0, 10); // "YYYY-MM-DD"
    const bucket = map.get(day) ?? [];
    bucket.push(task.id);
    map.set(day, bucket);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, taskIds]) => ({ date, taskIds }));
}

/**
 * Build the stable, deduplicated cross-bucket ordering used by pagination.
 *
 * Forecast naturally produces four overlapping task lists (a single task can
 * appear in `overdue` AND `flagged`, etc.). The cursor codec assumes a single
 * sorted sequence with unique IDs, so we walk all four buckets, dedup by
 * `id`, and emit one entry per task ordered by `(dueDate ASC nulls-last, id ASC)`
 * — the same convention `task_list` uses when `sortBy: "dueDate"` (#783).
 *
 * The handler re-buckets each paged task into every original bucket by
 * filtering the four source arrays against the page-id set, so we don't
 * need to track bucket membership here.
 */
function buildPageableUnion(result: {
  overdue: Task[];
  dueToday: Task[];
  deferredToday: Task[];
  flagged: Task[];
}): Task[] {
  const byId = new Map<string, Task>();
  const addAll = (tasks: Task[]) => {
    for (const t of tasks) if (!byId.has(t.id)) byId.set(t.id, t);
  };
  addAll(result.overdue);
  addAll(result.dueToday);
  addAll(result.deferredToday);
  addAll(result.flagged);

  return [...byId.values()].sort((a, b) => {
    const ad = a.dueDate ?? "";
    const bd = b.dueDate ?? "";
    // Null/missing dueDate sorts last (matches isAfterCursor nulls-last semantics).
    if (ad === "" && bd !== "") return 1;
    if (bd === "" && ad !== "") return -1;
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

/**
 * Filter inputs that participate in the cursor's `filterHash`. Anything that
 * changes which tasks are eligible for pagination must be hashed — but
 * `limit`/`cursor` themselves must NOT, or every page would invalidate the
 * previous cursor. `fields` is also excluded: projection changes the shape
 * of returned tasks but not which tasks are in the sequence (#783).
 */
function paginationFilter(input: ForecastGetToolInput): Record<string, unknown> {
  return {
    date: input.date,
    from: input.from,
    to: input.to,
    days: input.days,
    includeOverdue: input.includeOverdue,
    includeDeferred: input.includeDeferred,
    includeFlagged: input.includeFlagged,
  };
}

export async function handleForecastGet(input: ForecastGetToolInput, ctx: ForecastGetContext) {
  const { from, to, days } = resolveRange(input);
  const result = await ctx.forecastService.get({
    from,
    to,
    includeOverdue: input.includeOverdue,
    includeDeferred: input.includeDeferred,
    includeFlagged: input.includeFlagged,
  });

  const projection =
    input.fields !== undefined ? validateFields(input.fields, TASK_FIELD_NAMES_SET) : undefined;
  const projectFields = projection?.valid;
  const project = (t: Task) => applyProjection(t, projectFields);
  type ProjectedTask = ReturnType<typeof project>;

  // ── Pagination ───────────────────────────────────────────────────────────
  const limit = input.limit ?? DEFAULT_LIMIT;
  const filterHash = hashFilter(paginationFilter(input));
  const cursor = input.cursor !== undefined ? decodeCursor(input.cursor, filterHash) : undefined;
  const ordered = buildPageableUnion(result);

  const after = cursor
    ? ordered.filter((t) =>
        isAfterCursor({ id: t.id, sortValue: t.dueDate ?? null }, cursor, "asc"),
      )
    : ordered;
  const page = after.slice(0, limit);
  const hasMore = after.length > limit;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last !== undefined
      ? encodeCursor({ lastId: last.id, lastSortValue: last.dueDate ?? null, filterHash })
      : null;

  // Re-bucket the paged tasks into the response shape callers expect. A task
  // that originated in multiple buckets reappears in each.
  const pageIds = new Set(page.map((t) => t.id));
  const inPage = (tasks: Task[]) => tasks.filter((t) => pageIds.has(t.id)).map(project);

  const payload: {
    overdue: ProjectedTask[];
    dueToday: ProjectedTask[];
    deferredToday: ProjectedTask[];
    flagged: ProjectedTask[];
    byDate?: { date: string; taskIds: string[] }[];
  } = {
    overdue: inPage(result.overdue),
    dueToday: inPage(result.dueToday),
    deferredToday: inPage(result.deferredToday),
    flagged: inPage(result.flagged),
  };

  if (days > 1) {
    // groupByDate emits ID-only buckets (per A4) so byDate doesn't duplicate
    // task objects already inlined under dueToday. Restrict to the page's
    // dueToday entries so the IDs always dereference into the current page.
    payload.byDate = groupByDate(result.dueToday.filter((t) => pageIds.has(t.id)));
  }

  const pagination: Pagination = { cursor: nextCursor, hasMore };

  const warnings =
    projection !== undefined && projection.unknown.length > 0
      ? [warnUnknownFields([...projection.unknown], TASK_FIELD_NAMES)]
      : undefined;
  const meta = ctx.makeMeta({
    cacheHit: result.cacheHit,
    ...(warnings !== undefined ? { warnings } : {}),
  });

  return ok(payload, meta, pagination);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerForecastGetTool(server: McpServer, ctx: ForecastGetContext) {
  return server.registerTool(
    "forecast_get",
    {
      description: FORECAST_GET_DESCRIPTION,
      inputSchema: forecastGetInputSchema.shape,
    },
    async (args: ForecastGetToolInput) => {
      const envelope = await handleForecastGet(args, ctx);
      return toolResponse(envelope);
    },
  );
}
