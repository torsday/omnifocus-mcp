/**
 * `task_batch_drop` MCP tool — cancel (drop) many tasks in one round trip.
 *
 * Atomic validation + best-effort execution. Single JXA round trip.
 * Dropped tasks remain in OmniFocus but are treated as cancelled/inactive.
 *
 * @see src/tools/task/batchComplete.ts — sibling pattern
 * @see src/domain/batch.ts — BatchOutcome shape
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { TaskId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

export const TASK_BATCH_DROP_DESCRIPTION =
  "Cancel (drop) many OmniFocus tasks in a single JXA round trip. " +
  "Dropped tasks remain in OmniFocus but are treated as cancelled/inactive — " +
  "they do not appear in active task lists. Use task_batch_delete for permanent removal. " +
  "Validation is atomic: if any input fails schema, the whole batch is rejected " +
  "before any mutation. Execution is best-effort: each drop succeeds or fails " +
  "independently, and the response reports per-index outcomes. " +
  "Prefer this tool over repeated task_drop calls whenever dropping more than one task. " +
  "Each item is { id }. " +
  "Returns { dropped: [{index, value: taskId}], failed: [{index, errorCode, message}] }. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need changes to appear on other devices.";

const singleItemSchema = z.object({
  id: TaskId.schema.describe("Persistent task ID."),
});

export const taskBatchDropInputSchema = z.object({
  items: z
    .array(singleItemSchema)
    .min(1)
    .describe("Array of { id } items. Must contain at least one item."),
});

export type TaskBatchDropToolInput = z.infer<typeof taskBatchDropInputSchema>;

export interface TaskBatchDropContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleTaskBatchDrop(
  input: TaskBatchDropToolInput,
  ctx: TaskBatchDropContext,
) {
  const outcome = await ctx.adapter.batchDropTasks(input.items.map((it) => ({ id: it.id })));

  if (ctx.cache !== undefined) {
    for (const s of outcome.succeeded) {
      const src = input.items[s.index];
      if (src !== undefined) {
        invalidateTaskMutation(ctx.cache, { taskId: src.id });
      }
    }
  }

  return ok(
    { dropped: outcome.succeeded, failed: outcome.failed },
    ctx.makeMeta({ syncPending: outcome.succeeded.length > 0 }),
  );
}

export function registerTaskBatchDropTool(server: McpServer, ctx: TaskBatchDropContext) {
  return server.registerTool(
    "task_batch_drop",
    {
      description: TASK_BATCH_DROP_DESCRIPTION,
      inputSchema: taskBatchDropInputSchema.shape,
    },
    async (args: TaskBatchDropToolInput) => {
      const envelope = await handleTaskBatchDrop(args, ctx);
      return toolResponse(envelope);
    },
  );
}
