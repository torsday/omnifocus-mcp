/**
 * `task_find_by_name` MCP tool — disambiguation-aware task lookup by name.
 *
 * OmniFocus task names are **not unique** — two tasks can share a name and
 * often do. This tool is the explicit "I only have a name" escape hatch;
 * it returns **all** matching tasks and makes non-uniqueness visible rather
 * than silently picking one. The result is always an array (zero or more).
 *
 * Zero matches is **not** an error — callers distinguish "not found" from
 * "ambiguous" by array length. Only use this tool when you genuinely lack
 * an ID. If you have an ID, use `task_get`; if you need broad filtering,
 * use `task_list` or `search_query`.
 *
 * @see DESIGN.md §13 — ADR-0008 (IDs-only API; this tool is the escape hatch)
 * @see src/tools/task/list.ts — for filter-based listing
 * @see src/tools/search/query.ts — for full-text search
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_FIND_BY_NAME_DESCRIPTION =
  "Find tasks in OmniFocus by name. " +
  "Returns ALL matching tasks (names are not unique in OmniFocus). " +
  "Names collide in OmniFocus; prefer task_get with an ID when you have one. " +
  "Use search_query instead when you need to search task notes as well, or want full-text content search. " +
  "Zero matches returns an empty array — not an error. " +
  "Returns tasks[]; safe to call repeatedly; no side effects.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskFindByNameInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Name to search for. Behaviour depends on mode: exact = full name match; " +
        "prefix = name starts with this string; contains = substring match anywhere in name.",
    ),
  mode: z
    .enum(["exact", "prefix", "contains"])
    .optional()
    .describe(
      "'exact' = full task name must match (default); 'prefix' = name must start with query; " +
        "'contains' = query appears anywhere in name.",
    ),
  caseSensitive: z
    .boolean()
    .optional()
    .describe("true = match is case-sensitive; false = case-insensitive (default false)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Maximum number of results to return (1..500). Default 50."),
});

export type TaskFindByNameInput = z.infer<typeof taskFindByNameInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskFindByNameContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests.
 *
 * Fetches all tasks and applies name matching in-process. For JXA this is
 * equivalent to filtering `flattenedTasks` by a name predicate.
 */
export async function handleTaskFindByName(input: TaskFindByNameInput, ctx: TaskFindByNameContext) {
  const mode = input.mode ?? "exact";
  const caseSensitive = input.caseSensitive ?? false;
  const limit = input.limit ?? 50;

  // Fetch all tasks (adapter applies no name filter — we filter in-process)
  const allTasks = await ctx.adapter.listTasks({});

  const normalise = (s: string) => (caseSensitive ? s : s.toLowerCase());
  const q = normalise(input.query);

  const matched = allTasks.filter((task) => {
    const name = normalise(task.name);
    switch (mode) {
      case "exact":
        return name === q;
      case "prefix":
        return name.startsWith(q);
      case "contains":
        return name.includes(q);
      default:
        return false;
    }
  });

  const tasks = matched.slice(0, limit);
  const meta = ctx.makeMeta();
  return ok({ tasks, matchCount: matched.length }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskFindByNameTool(server: McpServer, ctx: TaskFindByNameContext) {
  return server.registerTool(
    "task_find_by_name",
    {
      description: TASK_FIND_BY_NAME_DESCRIPTION,
      inputSchema: taskFindByNameInputSchema.shape,
    },
    async (args: TaskFindByNameInput) => {
      const envelope = await handleTaskFindByName(args, ctx);
      return toolResponse(envelope);
    },
  );
}
