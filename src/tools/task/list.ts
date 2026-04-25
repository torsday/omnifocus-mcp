/**
 * `task_list` MCP tool — the reference implementation for read-shaped tools
 * in this server (DESIGN §26).
 *
 * Every other list tool inherits this structure:
 * - A zod input schema whose `.describe()` strings are the contract the LLM
 *   reads. Concise, imperative, says where to get IDs (see DESIGN §6.8.1).
 * - A thin handler (< 30 LOC per DESIGN maintainability target) that delegates
 *   to a `Service` method and wraps the result in the ADR-0013 envelope.
 * - No business logic in the handler — filter application, pagination,
 *   caching all live in the service.
 *
 * The `registerTaskListTool` helper is what `mcpServer.ts` calls to register
 * this tool with a configured {@link TaskService}.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see DESIGN.md §12 — response envelope
 * @see src/services/taskService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { flexDateString } from "../../domain/dates.js";
import { ProjectId, TagId, TaskId } from "../../domain/ids.js";
import { ok, type Pagination, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { TaskListInput, TaskService } from "../../services/taskService.js";
import { TaskSortBySchema } from "../../services/taskService.js";

// ---------------------------------------------------------------------------
// Tool description (shown to the LLM via tools/list)
// ---------------------------------------------------------------------------

export const TASK_LIST_DESCRIPTION =
  "List tasks in OmniFocus with optional filters (project, tag, flagged, completion, due dates). " +
  "Use this for filter-based queries across tasks. " +
  "Do NOT use for a known single task (use task_get). " +
  "For name-based lookup, prefer task_find_by_name. " +
  "For full-text content search across names and notes, prefer search_query. " +
  "Returns tasks[] with pagination; safe to call repeatedly; no side effects.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Raw-shape input schema for `task_list`. Exported as a zod object so the
 * MCP SDK can introspect it for `tools/list`, and so unit tests can parse
 * arbitrary payloads through it without re-declaring the types.
 *
 * Field descriptions follow DESIGN §6.8.1: what it does, where to get IDs,
 * what the default means if one is applied.
 */
export const taskListInputSchema = z.object({
  projectId: ProjectId.schema
    .optional()
    .describe(
      "Restrict to tasks in this project. Get the ID from project_list. Omit for all projects.",
    ),
  tagIds: z
    .array(TagId.schema)
    .optional()
    .describe("Restrict to tasks carrying ALL of these tag IDs. Get IDs from tag_list."),
  flagged: z
    .boolean()
    .optional()
    .describe("true = flagged only; false = unflagged only; omit = all."),
  available: z
    .boolean()
    .optional()
    .describe(
      "true = only tasks available to work on now (not blocked, not deferred). Omit = all.",
    ),
  completed: z
    .enum(["any", "only", "exclude"])
    .optional()
    .describe(
      "'exclude' = active tasks only; 'only' = completed tasks only; 'any' = both. Omit for adapter default.",
    ),
  dueBefore: z
    .string()
    .optional()
    .describe(
      "Tasks with dueDate strictly before this moment. ISO-8601 with offset (e.g. '2026-04-21T17:00:00-04:00').",
    ),
  dueAfter: z
    .string()
    .optional()
    .describe("Tasks with dueDate strictly after this moment. ISO-8601 with offset."),
  deferredBefore: z
    .string()
    .optional()
    .describe(
      "Tasks deferred until before this moment (already unlocked or soon). ISO-8601 with offset.",
    ),
  parentId: TaskId.schema
    .optional()
    .describe(
      "Restrict to direct children of this task (subtasks). Get the ID from task_get or task_list.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Max tasks per page (1..1000). Default 200. Use `cursor` to fetch subsequent pages."),
  sortBy: TaskSortBySchema.optional().describe(
    "Field to sort tasks by: 'createdAt' (default), 'dueDate', 'modifiedAt', or 'name'. " +
      "Tasks with no value for the chosen field (e.g. no dueDate) sort last.",
  ),
  sortDirection: z
    .enum(["asc", "desc"])
    .optional()
    .describe(
      "Sort direction: 'asc' (default, oldest/lowest first) or 'desc' (newest/highest first).",
    ),
  updatedSince: flexDateString()
    .optional()
    .describe(
      "Return only tasks modified strictly after this timestamp. " +
        "Accepts ISO-8601 with offset (e.g. '2026-04-21T10:00:00-07:00') or a relative shortcut: " +
        "today, yesterday, this-week, next-week, end-of-week, end-of-month. " +
        "Use this for incremental sync: call without updatedSince on session start, then pass the previous response timestamp on subsequent calls. " +
        "Note: deleted tasks cannot be detected — use a snapshot resource for deletion detection.",
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque cursor from a previous task_list response. Must use the same filters — changing filters mid-sequence returns a ValidationError.",
    ),
});

/** TypeScript input type derived from {@link taskListInputSchema}. */
export type TaskListToolInput = z.infer<typeof taskListInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Minimum meta-factory interface the handler needs. */
export interface ToolContext {
  taskService: TaskService;
  /** Produce request-scoped response meta. Supplied by the handler harness. */
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — separated from {@link registerTaskListTool} so unit tests
 * can invoke it without constructing an McpServer.
 */
export async function handleTaskList(input: TaskListToolInput, ctx: ToolContext) {
  const serviceInput = input as TaskListInput;
  const result = await ctx.taskService.list(serviceInput);
  const pagination: Pagination = {
    cursor: result.nextCursor,
    hasMore: result.hasMore,
  };
  const meta = ctx.makeMeta({ cacheHit: result.cacheHit });
  return ok({ tasks: result.tasks }, meta, pagination);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register `task_list` with an `McpServer` instance. The returned handle is
 * the SDK's `RegisteredTool` — callers may ignore it.
 */
export function registerTaskListTool(server: McpServer, ctx: ToolContext) {
  return server.registerTool(
    "task_list",
    {
      description: TASK_LIST_DESCRIPTION,
      inputSchema: taskListInputSchema.shape,
    },
    async (args: TaskListToolInput) => {
      const envelope = await handleTaskList(args, ctx);
      return toolResponse(envelope);
    },
  );
}
