/**
 * `task_search` MCP tool — full-text search and structured filtering.
 *
 * Combines a keyword query (optional) with structured filters for project,
 * tags, availability, due dates, flagged state, and completion state.
 * Returns the standard Task domain shape — the same as task_list — so
 * callers can act on results without a follow-up read.
 *
 * Either `q` or at least one filter must be supplied; neither alone is
 * required — you can search by tag-only, date-range-only, or text+filters.
 *
 * Use `task_list` for pagination/sorting over large result sets.
 * Use `task_search` when you have a keyword or need combined text+filter
 * queries that `task_list` cannot express.
 *
 * JXA implementation: in-process substring scan of flattenedTasks
 * (or flattenedTasks of a specific project when projectId is supplied).
 *
 * @see src/scripts/jxa/task_search.js — underlying JXA script
 * @see src/tools/task/list.ts — filter-based listing with pagination
 * @see src/tools/task/findByName.ts — exact/prefix/contains name-only lookup
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { flexDateString } from "../../domain/dates.js";
import { ProjectId, TagId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_SEARCH_DESCRIPTION =
  "Search OmniFocus tasks by keyword and/or structured filters. " +
  "q is optional — omit it to filter by tag, project, date range, or availability alone. " +
  "When q is supplied, scans task names and/or notes (controlled by scope) for a case-insensitive substring match. " +
  "Narrow results with: projectId, tagIds (task must carry ALL listed tags), " +
  "available, dueBefore, dueAfter, flagged, and completed. " +
  "At least one of q, projectId, tagIds, available, dueBefore, or dueAfter must be provided. " +
  "Do NOT use when you already have an ID — prefer task_get instead. " +
  "Prefer task_list for paginated browsing over large result sets. " +
  "Returns the full Task domain shape — same as task_list — so no follow-up read is needed. " +
  "Returns tasks[]; safe to call repeatedly; no side effects.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/** Shape used for MCP inputSchema registration (no refine — avoids ZodEffects). */
export const taskSearchInputShape = {
  q: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Search query. Case-insensitive substring match applied to the fields in scope. " +
        "Optional — omit to filter by tags, project, date range, or availability alone.",
    ),
  scope: z
    .enum(["name", "note", "all"])
    .optional()
    .describe(
      "'name' = search task name only; 'note' = search note only; 'all' = both (default). " +
        "Ignored when q is omitted.",
    ),
  projectId: ProjectId.schema.optional().describe("Restrict search to tasks within this project."),
  tagIds: z
    .array(TagId.schema)
    .optional()
    .describe("Restrict to tasks carrying ALL of these tag IDs."),
  available: z
    .boolean()
    .optional()
    .describe(
      "true = only tasks available to work on now (not blocked, not deferred, not completed). Omit = all.",
    ),
  dueBefore: flexDateString()
    .optional()
    .describe(
      "Tasks with dueDate strictly before this moment. ISO-8601 with offset or relative shortcut.",
    ),
  dueAfter: flexDateString()
    .optional()
    .describe(
      "Tasks with dueDate strictly after this moment. ISO-8601 with offset or relative shortcut.",
    ),
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
};

/** Full schema with at-least-one-field refinement — use for runtime validation. */
export const taskSearchInputSchema = z
  .object(taskSearchInputShape)
  .refine(
    (v) =>
      v.q !== undefined ||
      v.projectId !== undefined ||
      v.tagIds !== undefined ||
      v.available !== undefined ||
      v.dueBefore !== undefined ||
      v.dueAfter !== undefined,
    {
      message:
        "At least one of q, projectId, tagIds, available, dueBefore, or dueAfter must be provided.",
    },
  );

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
    ...(input.q !== undefined && { q: input.q }),
    ...(input.scope !== undefined && { scope: input.scope }),
    ...(input.projectId !== undefined && { projectId: input.projectId }),
    ...(input.tagIds !== undefined && { tagIds: input.tagIds }),
    ...(input.available !== undefined && { available: input.available }),
    ...(input.dueBefore !== undefined && { dueBefore: input.dueBefore }),
    ...(input.dueAfter !== undefined && { dueAfter: input.dueAfter }),
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
      inputSchema: taskSearchInputShape,
    },
    async (args: TaskSearchToolInput) => {
      const envelope = await handleTaskSearch(args, ctx);
      return toolResponse(envelope);
    },
  );
}
