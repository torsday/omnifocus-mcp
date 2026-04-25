/**
 * `task_search` MCP tool — full-text task search across name and/or note.
 *
 * Searches OmniFocus tasks by keyword, optionally narrowing by project,
 * tags, flagged state, and completion state. Returns the standard Task
 * domain shape — the same as task_list — so callers can act on results
 * without a follow-up read.
 *
 * JXA implementation: in-process substring scan of flattenedTasks
 * (or flattenedTasks of a specific project when projectId is supplied).
 * The whose-clause approach is skipped because it cannot span multiple
 * fields (name + note) in a single predicate.
 *
 * @see src/scripts/jxa/task_search.js — underlying JXA script
 * @see src/tools/task/list.ts — filter-based listing (no keyword)
 * @see src/tools/task/findByName.ts — exact/prefix/contains name-only lookup
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ProjectId, TagId } from "../../domain/ids.js";
import { type ResponseMeta, ok, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_SEARCH_DESCRIPTION =
  "Search OmniFocus tasks by keyword. " +
  "Scans task names and/or notes (controlled by scope) for a case-insensitive substring match. " +
  "Optionally narrow results by projectId, tagIds (task must carry ALL listed tags), " +
  "flagged state, and completion state. " +
  "Do NOT use when you already have an ID — prefer task_get instead. " +
  "Do NOT use for structured browsing by project/tag; prefer task_list for that. " +
  "Returns the full Task domain shape — same as task_list — so no follow-up read is needed. " +
  "Returns tasks[]; safe to call repeatedly; no side effects.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskSearchInputSchema = z.object({
  q: z
    .string()
    .min(1)
    .describe("Search query. Case-insensitive substring match applied to the fields in scope."),
  scope: z
    .enum(["name", "note", "all"])
    .optional()
    .describe("'name' = search task name only; 'note' = search note only; 'all' = both (default)."),
  projectId: ProjectId.schema.optional().describe("Restrict search to tasks within this project."),
  tagIds: z
    .array(TagId.schema)
    .optional()
    .describe("Restrict to tasks carrying ALL of these tag IDs."),
  flagged: z
    .boolean()
    .optional()
    .describe("true = flagged tasks only; false = unflagged only; omit = all."),
  completed: z
    .enum(["any", "only", "exclude"])
    .optional()
    .describe(
      "'exclude' = active tasks only (default); 'only' = completed tasks only; 'any' = both.",
    ),
});

export type TaskSearchToolInput = z.infer<typeof taskSearchInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskSearchContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `task_search`.
 *
 * Delegates to `adapter.searchTasks()` which executes the `task_search.js`
 * JXA script with the supplied filter parameters.
 */
export async function handleTaskSearch(input: TaskSearchToolInput, ctx: TaskSearchContext) {
  const tasks = await ctx.adapter.searchTasks({
    q: input.q,
    ...(input.scope !== undefined && { scope: input.scope }),
    ...(input.projectId !== undefined && { projectId: input.projectId }),
    ...(input.tagIds !== undefined && { tagIds: input.tagIds }),
    ...(input.flagged !== undefined && { flagged: input.flagged }),
    ...(input.completed !== undefined && { completed: input.completed }),
  });
  return ok({ tasks }, ctx.makeMeta());
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskSearchTool(server: McpServer, ctx: TaskSearchContext) {
  return server.registerTool(
    "task_search",
    {
      description: TASK_SEARCH_DESCRIPTION,
      inputSchema: taskSearchInputSchema.shape,
    },
    async (args: TaskSearchToolInput) => {
      const envelope = await handleTaskSearch(args, ctx);
      return toolResponse(envelope);
    },
  );
}
