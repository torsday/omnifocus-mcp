/**
 * `task_batch_complete` MCP tool — mark many tasks complete in one round trip.
 *
 * Atomic validation + best-effort execution. Single JXA round trip.
 *
 * @see src/tools/task/complete.ts — singular counterpart
 * @see src/domain/batch.ts — BatchOutcome shape
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { TaskId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";

export const TASK_BATCH_COMPLETE_DESCRIPTION =
  "Mark many OmniFocus tasks complete in a single JXA round trip. " +
  "Validation is atomic: if any input fails schema, the whole batch is rejected " +
  "before any mutation. Execution is best-effort: each completion succeeds or fails " +
  "independently, and the response reports per-index outcomes. " +
  "Prefer this tool over repeated task_complete calls whenever you are completing more than one task. " +
  "Each item is { id, at? } where `at` is an optional ISO-8601 completion timestamp (defaults to now). " +
  "Already-completed tasks are not treated specially here — use task_complete's idempotent noChange " +
  "path if you need that per-item semantics. " +
  "Returns { completed: [{index, value: taskId}], failed: [{index, errorCode, message}] }. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need changes to appear on other devices.";

const singleItemSchema = z.object({
  id: TaskId.schema.describe("Persistent task ID."),
  at: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("Optional ISO-8601 completion time; defaults to now."),
});

export const taskBatchCompleteInputBaseSchema = z.object({
  items: z
    .array(singleItemSchema)
    .min(1)
    .describe("Array of { id, at? } items. Must contain at least one item."),
});

export type TaskBatchCompleteToolInput = z.infer<typeof taskBatchCompleteInputBaseSchema>;

export interface TaskBatchCompleteContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleTaskBatchComplete(
  input: TaskBatchCompleteToolInput,
  ctx: TaskBatchCompleteContext,
) {
  const adapterInputs = input.items.map((it) => ({
    id: it.id,
    ...(it.at !== undefined && { at: new Date(it.at) }),
  }));

  const outcome = await ctx.adapter.batchCompleteTasks(adapterInputs);

  if (ctx.cache !== undefined) {
    for (const s of outcome.succeeded) {
      const src = input.items[s.index];
      if (src !== undefined) {
        invalidateTaskMutation(ctx.cache, { taskId: src.id });
      }
    }
  }

  return ok(
    { completed: outcome.succeeded, failed: outcome.failed },
    ctx.makeMeta({ syncPending: outcome.succeeded.length > 0 }),
  );
}

export function registerTaskBatchCompleteTool(server: McpServer, ctx: TaskBatchCompleteContext) {
  return server.registerTool(
    "task_batch_complete",
    {
      description: TASK_BATCH_COMPLETE_DESCRIPTION,
      inputSchema: taskBatchCompleteInputBaseSchema.shape,
    },
    async (args: TaskBatchCompleteToolInput) => {
      const envelope = await handleTaskBatchComplete(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
