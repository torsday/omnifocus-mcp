/**
 * `task_batch_uncomplete` MCP tool — mark many tasks incomplete in one round trip.
 *
 * Atomic validation + best-effort execution. Single JXA round trip.
 * Uncompleted tasks are returned to their previous incomplete state.
 *
 * @see src/tools/task/batchComplete.ts — sibling pattern
 * @see src/domain/batch.ts — BatchOutcome shape
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { TaskId } from "../../domain/ids.js";
import { summaryBatchUncomplete } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

export const TASK_BATCH_UNCOMPLETE_DESCRIPTION =
  "Mark many OmniFocus tasks as incomplete in a single JXA round trip. " +
  "Reverses a previous completion — useful when a task was completed by mistake " +
  "or needs to be re-done. Uncompleted tasks return to active status. " +
  "Use task_batch_complete to mark tasks as completed. " +
  "Validation is atomic: if any input fails schema, the whole batch is rejected " +
  "before any mutation. Execution is best-effort: each uncomplete succeeds or fails " +
  "independently, and the response reports per-index outcomes. " +
  "Prefer this tool over repeated task_uncomplete calls whenever uncompleting more than one task. " +
  "Each item is { id }. " +
  "Returns { uncompleted: [{index, value: { id, name }}], failed: [{index, errorCode, message}] } — value carries the task name so the agent can describe each restoration without a follow-up read. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need changes to appear on other devices.";

const singleItemSchema = z.object({
  id: TaskId.schema.describe("Persistent task ID."),
});

export const taskBatchUncompleteInputSchema = z.object({
  items: z
    .array(singleItemSchema)
    .min(1)
    .describe("Array of { id } items. Must contain at least one item."),
});

export type TaskBatchUncompleteToolInput = z.infer<typeof taskBatchUncompleteInputSchema>;

export interface TaskBatchUncompleteContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleTaskBatchUncomplete(
  input: TaskBatchUncompleteToolInput,
  ctx: TaskBatchUncompleteContext,
) {
  // Pre-fetch all task names in a single round trip — see batchComplete (#594 lever 4).
  const ids = input.items.map((it) => it.id);
  const tasks = await ctx.adapter.getTasksMany(ids);
  const nameById = new Map<string, string>();
  for (let i = 0; i < ids.length; i++) {
    const task = tasks[i];
    if (task !== null && task !== undefined) {
      nameById.set(ids[i] as string, task.name);
    }
  }

  const outcome = await ctx.adapter.batchUncompleteTasks(input.items.map((it) => ({ id: it.id })));

  if (ctx.cache !== undefined) {
    for (const s of outcome.succeeded) {
      const src = input.items[s.index];
      if (src !== undefined) {
        invalidateTaskMutation(ctx.cache, { taskId: src.id });
      }
    }
  }

  const uncompleted = outcome.succeeded.map((s) => ({
    index: s.index,
    value: { id: s.value, name: nameById.get(s.value as string) ?? "" },
  }));

  return ok(
    { uncompleted, failed: outcome.failed },
    ctx.makeMeta({
      syncPending: outcome.succeeded.length > 0,
      humanReadableSummary: summaryBatchUncomplete(outcome.succeeded.length),
    }),
  );
}

export function registerTaskBatchUncompleteTool(
  server: McpServer,
  ctx: TaskBatchUncompleteContext,
) {
  return server.registerTool(
    "task_batch_uncomplete",
    {
      description: TASK_BATCH_UNCOMPLETE_DESCRIPTION,
      inputSchema: taskBatchUncompleteInputSchema.shape,
    },
    async (args: TaskBatchUncompleteToolInput) => {
      const envelope = await handleTaskBatchUncomplete(args, ctx);
      return toolResponse(envelope);
    },
  );
}
