/**
 * `task_batch_delete` MCP tool — permanently delete many tasks in one round trip.
 *
 * Atomic validation + best-effort execution. Single JXA round trip.
 * **Irreversible** — deleted tasks cannot be recovered.
 *
 * @see src/tools/task/batchComplete.ts — sibling pattern
 * @see src/domain/batch.ts — BatchOutcome shape
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { TaskId } from "../../domain/ids.js";
import { summaryBatchDelete } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

export const TASK_BATCH_DELETE_DESCRIPTION =
  "Permanently delete many OmniFocus tasks in a single JXA round trip. " +
  "IRREVERSIBLE — deleted tasks cannot be recovered. " +
  "REQUIRED: pass confirm=true at the top level to acknowledge this action is irreversible; the entire batch is rejected without it. " +
  "Validation is atomic: if any input fails schema, the whole batch is rejected " +
  "before any mutation. Execution is best-effort: each deletion succeeds or fails " +
  "independently, and the response reports per-index outcomes. " +
  "Prefer this tool over repeated task_delete calls whenever deleting more than one task. " +
  "Each item is { id }. " +
  "Returns { deleted: [{index, value: taskId}], failed: [{index, errorCode, message}] }. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need changes to appear on other devices.";

const singleItemSchema = z.object({
  id: TaskId.schema.describe("Persistent task ID."),
});

export const taskBatchDeleteInputSchema = z.object({
  confirm: z
    .literal(true)
    .describe(
      "Explicit acknowledgement that all deletions are permanent and irreversible. " +
        "Must be exactly true. The entire batch is rejected if this field is absent or false.",
    ),
  items: z
    .array(singleItemSchema)
    .min(1)
    .describe("Array of { id } items. Must contain at least one item."),
});

export type TaskBatchDeleteToolInput = z.infer<typeof taskBatchDeleteInputSchema>;

export interface TaskBatchDeleteContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleTaskBatchDelete(
  input: TaskBatchDeleteToolInput,
  ctx: TaskBatchDeleteContext,
) {
  const outcome = await ctx.adapter.batchDeleteTasks(input.items.map((it) => ({ id: it.id })));

  if (ctx.cache !== undefined) {
    for (const s of outcome.succeeded) {
      const src = input.items[s.index];
      if (src !== undefined) {
        invalidateTaskMutation(ctx.cache, { taskId: src.id });
      }
    }
  }

  return ok(
    { deleted: outcome.succeeded, failed: outcome.failed },
    ctx.makeMeta({
      syncPending: outcome.succeeded.length > 0,
      humanReadableSummary: summaryBatchDelete(outcome.succeeded.length),
    }),
  );
}

export function registerTaskBatchDeleteTool(server: McpServer, ctx: TaskBatchDeleteContext) {
  return server.registerTool(
    "task_batch_delete",
    {
      description: TASK_BATCH_DELETE_DESCRIPTION,
      inputSchema: taskBatchDeleteInputSchema.shape,
    },
    async (args: TaskBatchDeleteToolInput) => {
      const envelope = await handleTaskBatchDelete(args, ctx);
      return toolResponse(envelope);
    },
  );
}
