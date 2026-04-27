/**
 * `task_batch_undrop` MCP tool — restore (undrop) many tasks in one round trip.
 *
 * Atomic validation + best-effort execution. Single JXA round trip.
 * Undropped tasks are restored to active status in OmniFocus.
 *
 * @see src/tools/task/batchDrop.ts — sibling pattern
 * @see src/domain/batch.ts — BatchOutcome shape
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { TaskId } from "../../domain/ids.js";
import { summaryBatchUndrop } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

export const TASK_BATCH_UNDROP_DESCRIPTION =
  "Restore (undrop) many cancelled OmniFocus tasks in a single JXA round trip. " +
  "Undropped tasks are returned to active status and will reappear in active task lists. " +
  "Use task_batch_drop to cancel tasks. " +
  "Validation is atomic: if any input fails schema, the whole batch is rejected " +
  "before any mutation. Execution is best-effort: each undrop succeeds or fails " +
  "independently, and the response reports per-index outcomes. " +
  "Prefer this tool over repeated task_undrop calls whenever undropping more than one task. " +
  "Each item is { id }. " +
  "Returns { undropped: [{index, value: taskId}], failed: [{index, errorCode, message}] }. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need changes to appear on other devices.";

const singleItemSchema = z.object({
  id: TaskId.schema.describe("Persistent task ID."),
});

export const taskBatchUndropInputSchema = z.object({
  items: z
    .array(singleItemSchema)
    .min(1)
    .describe("Array of { id } items. Must contain at least one item."),
});

export type TaskBatchUndropToolInput = z.infer<typeof taskBatchUndropInputSchema>;

export interface TaskBatchUndropContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleTaskBatchUndrop(
  input: TaskBatchUndropToolInput,
  ctx: TaskBatchUndropContext,
) {
  const outcome = await ctx.adapter.batchUndropTasks(input.items.map((it) => ({ id: it.id })));

  if (ctx.cache !== undefined) {
    for (const s of outcome.succeeded) {
      const src = input.items[s.index];
      if (src !== undefined) {
        invalidateTaskMutation(ctx.cache, { taskId: src.id });
      }
    }
  }

  return ok(
    { undropped: outcome.succeeded, failed: outcome.failed },
    ctx.makeMeta({
      syncPending: outcome.succeeded.length > 0,
      humanReadableSummary: summaryBatchUndrop(outcome.succeeded.length),
    }),
  );
}

export function registerTaskBatchUndropTool(server: McpServer, ctx: TaskBatchUndropContext) {
  return server.registerTool(
    "task_batch_undrop",
    {
      description: TASK_BATCH_UNDROP_DESCRIPTION,
      inputSchema: taskBatchUndropInputSchema.shape,
    },
    async (args: TaskBatchUndropToolInput) => {
      const envelope = await handleTaskBatchUndrop(args, ctx);
      return toolResponse(envelope);
    },
  );
}
