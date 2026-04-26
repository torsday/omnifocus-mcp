/**
 * `task_complete` MCP tool — mark an OmniFocus task as done.
 *
 * @see src/tools/task/uncomplete.ts — reverse operation
 * @see src/tools/task/drop.ts — task_drop (deferred without completing)
 * @see src/tools/task/delete.ts — task_delete (irreversible hard removal)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { TaskId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_COMPLETE_DESCRIPTION =
  "Complete an OmniFocus task — marks it done with a completion timestamp. " +
  "Accepts an optional ISO-8601 date for the completion time; defaults to now. " +
  "Idempotent: returns noChange: true if the task is already completed. " +
  "Do not use to drop or delete a task. " +
  "Returns { done: true, id } or { noChange: true, id }. " +
  "Side effects: sets completedAt, sets meta.syncPending = true.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskCompleteInputSchema = z.object({
  id: TaskId.schema.describe("Persistent task ID."),
  at: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("ISO-8601 completion time. Defaults to now."),
});

export type TaskCompleteToolInput = z.infer<typeof taskCompleteInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskCompleteContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleTaskComplete(input: TaskCompleteToolInput, ctx: TaskCompleteContext) {
  const task = await ctx.adapter.getTask(input.id);
  if (task.completed) {
    return ok({ noChange: true as const, id: input.id }, ctx.makeMeta());
  }
  const at = input.at !== undefined ? new Date(input.at) : undefined;
  await ctx.adapter.completeTask(input.id, at);
  if (ctx.cache !== undefined) {
    invalidateTaskMutation(ctx.cache, { taskId: input.id, projectId: task.projectId });
  }
  return ok({ done: true as const, id: input.id }, ctx.makeMeta({ syncPending: true }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskCompleteTool(server: McpServer, ctx: TaskCompleteContext) {
  return server.registerTool(
    "task_complete",
    { description: TASK_COMPLETE_DESCRIPTION, inputSchema: taskCompleteInputSchema.shape },
    async (args: TaskCompleteToolInput) => {
      const envelope = await handleTaskComplete(args, ctx);
      return toolResponse(envelope);
    },
  );
}
