/**
 * `task_get_many` MCP tool — fetch up to 100 tasks by persistent ID in one
 * OmniFocus round-trip.
 *
 * Agents frequently accumulate task IDs from multiple sources (a perspective
 * result, a search result, a resource read) and need full task objects for
 * all of them. Without this tool they would make N serial `task_get` calls;
 * this batches them into one JXA script invocation.
 *
 * ## Behaviour
 *
 * - Tasks are returned in the **same order** as the input `ids` array.
 * - IDs that are not found (deleted, never existed) are **omitted** from the
 *   result — they are **not** errors. They surface in `meta.warnings` under
 *   the `WARN_IDS_NOT_FOUND` code with `details.missing` listing the IDs.
 * - An empty `ids` array returns `[]` immediately without touching OmniFocus.
 * - Passing more than 100 IDs returns `OF_VALIDATION` (too large to batch).
 *
 * @see DESIGN.md §26 — tool pattern
 * @see src/envelope/index.ts — WARN_IDS_NOT_FOUND builder
 * @see src/adapter/OmniFocusAdapter.ts — getTasksMany contract
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { TaskId } from "../../domain/ids.js";
import { parseWaitingOn, type WaitingOn } from "../../domain/waitingOn.js";
import { ok, type ResponseMeta, toolResponse, warnIdsNotFound } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_GET_MANY_DESCRIPTION =
  "Fetch up to 100 tasks by persistent ID in a single OmniFocus round-trip. " +
  "Use when you have a set of task IDs from multiple sources and need full task objects for all of them. " +
  "Do NOT use for a single ID — use task_get instead. " +
  "Do NOT use when you only have names — use task_find_by_name. " +
  "Returns Task[] in input order. Missing IDs are omitted and appear in meta.warnings. " +
  "Read-only; safe to retry.";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_IDS = 100;

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskGetManyInputSchema = z.object({
  ids: z
    .array(TaskId.schema)
    .min(0)
    .max(MAX_IDS)
    .describe(
      `Array of task IDs to fetch (0..${MAX_IDS}). Get IDs from task_list, search_query, or task_find_by_name. Missing IDs are omitted (not errors) and appear in meta.warnings.`,
    ),
});

export type TaskGetManyInput = z.infer<typeof taskGetManyInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskGetManyContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests.
 *
 * Delegates to `adapter.getTasksMany` which returns `(Task | null)[]` with
 * `null` for each position where the ID was not found. This handler strips
 * the nulls and emits a `WARN_IDS_NOT_FOUND` warning if any were missing.
 */
export async function handleTaskGetMany(input: TaskGetManyInput, ctx: TaskGetManyContext) {
  // Fast path — empty input never touches the adapter
  if (input.ids.length === 0) {
    return ok({ tasks: [] }, ctx.makeMeta());
  }

  // The Zod schema already enforces max 100, but guard defensively for
  // callers that bypass schema validation (e.g. direct handler tests).
  if (input.ids.length > MAX_IDS) {
    throw new ValidationError(
      `ids array exceeds the maximum batch size of ${MAX_IDS} (got ${input.ids.length})`,
      { details: { field: "ids" } },
    );
  }

  const raw = await ctx.adapter.getTasksMany(input.ids);

  const tasks = raw.filter((t): t is NonNullable<typeof t> => t !== null);
  const missing = input.ids.filter((_id, i) => raw[i] === null);

  // Surface parsed waiting-on data as a sibling field keyed by task id so the
  // Task domain object stays the canonical wire shape (#482).
  const waitingOn: Record<string, WaitingOn> = {};
  for (const t of tasks) {
    const entry = parseWaitingOn(t.note);
    if (entry !== undefined) waitingOn[t.id] = entry;
  }
  const hasWaitingOn = Object.keys(waitingOn).length > 0;

  const warnings = missing.length > 0 ? [warnIdsNotFound(missing)] : undefined;
  const meta = ctx.makeMeta({ ...(warnings !== undefined ? { warnings } : {}) });

  return ok({ tasks, ...(hasWaitingOn && { waitingOn }) }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskGetManyTool(server: McpServer, ctx: TaskGetManyContext) {
  return server.registerTool(
    "task_get_many",
    {
      description: TASK_GET_MANY_DESCRIPTION,
      inputSchema: taskGetManyInputSchema.shape,
    },
    async (args: TaskGetManyInput) => {
      const envelope = await handleTaskGetMany(args, ctx);
      return toolResponse(envelope);
    },
  );
}
