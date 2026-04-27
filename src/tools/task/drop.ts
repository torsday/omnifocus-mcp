/**
 * `task_drop` MCP tool — drop an OmniFocus task (reversible status change).
 *
 * @see src/tools/task/undrop.ts — reverse operation
 * @see src/tools/task/complete.ts — task_complete (marks done, not dropped)
 * @see src/tools/task/delete.ts — task_delete (irreversible hard removal)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { TaskId } from "../../domain/ids.js";
import { summaryTaskDrop } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_DROP_DESCRIPTION =
  "Drop an OmniFocus task — marks it as dropped/deferred and removes it from active view. " +
  "Reversible via task_undrop. " +
  "Accepts an optional ISO-8601 date. " +
  "Idempotent: returns noChange: true if already dropped. " +
  "Do not use to complete or delete a task. " +
  "Returns { done: true, id } or { noChange: true, id }. " +
  "Side effects: sets droppedAt, sets meta.syncPending = true.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskDropInputSchema = z.object({
  id: TaskId.schema.describe("Persistent task ID."),
  at: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("ISO-8601 drop time. Defaults to now."),
});

export type TaskDropToolInput = z.infer<typeof taskDropInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskDropContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleTaskDrop(input: TaskDropToolInput, ctx: TaskDropContext) {
  const task = await ctx.adapter.getTask(input.id);
  if (task.dropped) {
    return ok({ noChange: true as const, id: input.id }, ctx.makeMeta());
  }
  const at = input.at !== undefined ? new Date(input.at) : undefined;
  await ctx.adapter.dropTask(input.id, at);
  if (ctx.cache !== undefined) {
    invalidateTaskMutation(ctx.cache, { taskId: input.id, projectId: task.projectId });
  }
  return ok(
    { done: true as const, id: input.id },
    ctx.makeMeta({ syncPending: true, humanReadableSummary: summaryTaskDrop(task.name) }),
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskDropTool(server: McpServer, ctx: TaskDropContext) {
  return server.registerTool(
    "task_drop",
    { description: TASK_DROP_DESCRIPTION, inputSchema: taskDropInputSchema.shape },
    async (args: TaskDropToolInput) => {
      const envelope = await handleTaskDrop(args, ctx);
      return toolResponse(envelope);
    },
  );
}
