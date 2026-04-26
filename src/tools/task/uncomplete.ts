/**
 * `task_uncomplete` MCP tool — mark an OmniFocus task as incomplete.
 *
 * @see src/tools/task/complete.ts — reverse operation
 * @see src/tools/task/undrop.ts — task_undrop (restore a dropped task)
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

export const TASK_UNCOMPLETE_DESCRIPTION =
  "Mark an OmniFocus task as incomplete — removes its completion timestamp. " +
  "Idempotent: returns noChange: true if the task is already incomplete. " +
  "Do not use to drop or delete a task. " +
  "Returns { done: true, id } or { noChange: true, id }. " +
  "Side effects: clears completedAt, sets meta.syncPending = true.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskUncompleteInputSchema = z.object({
  id: TaskId.schema.describe("Persistent task ID."),
});

export type TaskUncompleteToolInput = z.infer<typeof taskUncompleteInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskUncompleteContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleTaskUncomplete(
  input: TaskUncompleteToolInput,
  ctx: TaskUncompleteContext,
) {
  const task = await ctx.adapter.getTask(input.id);
  if (task.completed === false) {
    return ok({ noChange: true as const, id: input.id }, ctx.makeMeta());
  }
  await ctx.adapter.uncompleteTask(input.id);
  if (ctx.cache !== undefined) {
    invalidateTaskMutation(ctx.cache, { taskId: input.id, projectId: task.projectId });
  }
  return ok({ done: true as const, id: input.id }, ctx.makeMeta({ syncPending: true }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskUncompleteTool(server: McpServer, ctx: TaskUncompleteContext) {
  return server.registerTool(
    "task_uncomplete",
    { description: TASK_UNCOMPLETE_DESCRIPTION, inputSchema: taskUncompleteInputSchema.shape },
    async (args: TaskUncompleteToolInput) => {
      const envelope = await handleTaskUncomplete(args, ctx);
      return toolResponse(envelope);
    },
  );
}
