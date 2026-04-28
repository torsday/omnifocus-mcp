/**
 * `task_undrop` MCP tool — restore a dropped OmniFocus task to active view.
 *
 * @see src/tools/task/drop.ts — reverse operation
 * @see src/tools/task/uncomplete.ts — task_uncomplete (undo completion)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { TaskId } from "../../domain/ids.js";
import { summaryTaskUndrop } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_UNDROP_DESCRIPTION =
  "Restore a dropped OmniFocus task — clears its dropped status and returns it to the active view. " +
  "Idempotent: returns noChange: true if the task is not dropped. " +
  "Do not use to complete a task. " +
  "Returns { done: true, id, name } or { noChange: true, id, name } — name lets the agent describe the change without a follow-up read. " +
  "Side effects: clears droppedAt, sets meta.syncPending = true."" +
  'Example: task_undrop({ id: "abc123" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskUndropInputSchema = z.object({
  id: TaskId.schema.describe("Persistent task ID."),
});

export type TaskUndropToolInput = z.infer<typeof taskUndropInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskUndropContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleTaskUndrop(input: TaskUndropToolInput, ctx: TaskUndropContext) {
  const task = await ctx.adapter.getTask(input.id);
  if (task.dropped === false) {
    return ok({ noChange: true as const, id: input.id, name: task.name }, ctx.makeMeta());
  }
  await ctx.adapter.undropTask(input.id);
  if (ctx.cache !== undefined) {
    invalidateTaskMutation(ctx.cache, { taskId: input.id, projectId: task.projectId });
  }
  return ok(
    { done: true as const, id: input.id, name: task.name },
    ctx.makeMeta({ syncPending: true, humanReadableSummary: summaryTaskUndrop(task.name) }),
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskUndropTool(server: McpServer, ctx: TaskUndropContext) {
  return server.registerTool(
    "task_undrop",
    { description: TASK_UNDROP_DESCRIPTION, inputSchema: taskUndropInputSchema.shape },
    async (args: TaskUndropToolInput) => {
      const envelope = await handleTaskUndrop(args, ctx);
      return toolResponse(envelope);
    },
  );
}
