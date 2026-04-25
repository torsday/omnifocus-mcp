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
import { flexDateString } from "../../domain/dates.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ForecastService } from "../../services/forecastService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const FORECAST_GET_DESCRIPTION =
  "Get forecast-view tasks from OmniFocus grouped by category: overdue, dueToday, deferredToday, flagged. " +
  "Use this for 'what's on my plate today' queries. " +
  "Do NOT use to list all tasks across all projects; prefer task_list instead. " +
  "from/to default to today (ISO-8601 date strings). " +
  "All include flags default to true; set to false to omit a category. " +
  "Returns { overdue[], dueToday[], deferredToday[], flagged[] }. " +
  "Safe to call repeatedly; no side effects.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const forecastGetInputSchema = z.object({
  from: flexDateString()
    .optional()
    .describe(
      "Start of date range (ISO-8601 or relative shortcut like 'today'). Defaults to start of today.",
    ),
  to: flexDateString()
    .optional()
    .describe(
      "End of date range (ISO-8601 or relative shortcut like 'today'). Defaults to end of today.",
    ),
  includeOverdue: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include tasks overdue before `from`. Default true."),
  includeDeferred: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include tasks whose defer date falls within [from, to]. Default true."),
  includeFlagged: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include all flagged incomplete tasks. Default true."),
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
 * Resolve `from`/`to` to ISO-8601 strings representing start and end of today
 * when not supplied.
 */
function resolveRange(
  from: string | undefined,
  to: string | undefined,
): { from: string; to: string } {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  return {
    from: from ?? startOfToday.toISOString(),
    to: to ?? endOfToday.toISOString(),
  };
}

export async function handleForecastGet(input: ForecastGetToolInput, ctx: ForecastGetContext) {
  const { from, to } = resolveRange(input.from, input.to);
  const result = await ctx.forecastService.get({
    from,
    to,
    includeOverdue: input.includeOverdue,
    includeDeferred: input.includeDeferred,
    includeFlagged: input.includeFlagged,
  });
  const meta = ctx.makeMeta({ cacheHit: result.cacheHit });
  return ok(
    {
      overdue: result.overdue,
      dueToday: result.dueToday,
      deferredToday: result.deferredToday,
      flagged: result.flagged,
    },
    meta,
  );
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
