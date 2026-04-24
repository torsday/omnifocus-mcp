/**
 * `task_get` MCP tool — fetch a single OmniFocus task by persistent ID.
 *
 * Use when you have a known task ID and need its full detail — optionally
 * including its direct subtask list. For multiple IDs, prefer task_get_many.
 * For lookups by name, use task_find_by_name (when it exists).
 *
 * @see DESIGN.md §26 — tool pattern
 * @see src/services/taskService.ts — TaskService.get
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskId } from "../../domain/ids.js";
import { type ResponseMeta, ok, toolResponse } from "../../envelope/index.js";
import type { TaskGetInput, TaskService } from "../../services/taskService.js";

export const TASK_GET_DESCRIPTION =
  "Fetch a single OmniFocus task by persistent ID. " +
  "Use when you have a known task ID and need its full detail. " +
  "Do NOT use for multiple IDs — use task_get_many instead. " +
  "Returns the Task object plus its direct subtasks (when includeSubtasks=true, the default). " +
  "Read-only; safe to retry.";

export const taskGetInputSchema = z.object({
  id: TaskId.schema.describe(
    "Persistent ID of the task to fetch. Get from task_list or task_get_many.",
  ),
  includeSubtasks: z
    .boolean()
    .optional()
    .describe("Include direct subtasks in the response. Default true."),
});

export type TaskGetToolInput = z.infer<typeof taskGetInputSchema>;

export interface TaskGetContext {
  taskService: TaskService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for task_get.
 * @throws {NotFound} when the task ID does not exist
 * @throws {OmniFocusNotRunning} when OmniFocus is not running
 */
export async function handleTaskGet(input: TaskGetToolInput, ctx: TaskGetContext) {
  const result = await ctx.taskService.get(input as TaskGetInput);
  return ok(
    { task: result.task, ...(result.subtasks !== undefined && { subtasks: result.subtasks }) },
    ctx.makeMeta({ cacheHit: result.cacheHit }),
  );
}

export function registerTaskGetTool(server: McpServer, ctx: TaskGetContext) {
  return server.registerTool(
    "task_get",
    { description: TASK_GET_DESCRIPTION, inputSchema: taskGetInputSchema.shape },
    async (args: TaskGetToolInput) => {
      const envelope = await handleTaskGet(args, ctx);
      return toolResponse(envelope);
    },
  );
}
