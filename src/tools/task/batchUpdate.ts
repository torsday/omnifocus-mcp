/**
 * `task_batch_update` MCP tool — patch many tasks in a single round trip.
 *
 * Atomic validation (schema failures reject the whole batch before any
 * mutation) + best-effort execution (per-item success/failure at the
 * adapter). Single JXA round trip regardless of batch size.
 *
 * @see src/tools/task/update.ts — singular counterpart
 * @see src/domain/batch.ts — BatchOutcome shape
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter, UpdateTaskInput } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { TagId, TaskId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";

export const TASK_BATCH_UPDATE_DESCRIPTION =
  "Partially update many OmniFocus tasks in a single JXA round trip. " +
  "Validation is atomic: if any patch fails schema, the whole batch is rejected " +
  "before any mutation. Execution is best-effort: each update succeeds or fails " +
  "independently, and the response reports per-index outcomes. " +
  "Prefer this tool over repeated task_update calls whenever you are updating more than one task. " +
  "Each item is { id, patch } where patch accepts a subset of task_update's editable fields " +
  "(name, note, flagged, dueDate, deferDate, estimatedMinutes, tagIds, sequential, completedByChildren). " +
  "Additive tag diffs (addTags/removeTags) and safety primitives (dry_run, expectedModifiedAt, " +
  "idempotency_key) are not supported in batch form; fall back to task_update for those. " +
  "Returns { updated: [{index, value: taskId}], failed: [{index, errorCode, message}] }. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need changes to appear on other devices.";

const patchSchema = z
  .object({
    name: z.string().min(1).optional(),
    note: z.string().nullable().optional(),
    flagged: z.boolean().optional(),
    dueDate: z.string().datetime({ offset: true }).nullable().optional(),
    deferDate: z.string().datetime({ offset: true }).nullable().optional(),
    estimatedMinutes: z.number().int().positive().nullable().optional(),
    tagIds: z.array(TagId.schema).optional(),
    sequential: z.boolean().optional(),
    completedByChildren: z.boolean().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, {
    message: "Patch must contain at least one field",
  });

const singleItemSchema = z.object({
  id: TaskId.schema.describe("Persistent task ID."),
  patch: patchSchema.describe("Fields to change. At least one field required."),
});

export const taskBatchUpdateInputBaseSchema = z.object({
  items: z
    .array(singleItemSchema)
    .min(1)
    .describe("Array of { id, patch } pairs. Must contain at least one item."),
});

export type TaskBatchUpdateToolInput = z.infer<typeof taskBatchUpdateInputBaseSchema>;

export interface TaskBatchUpdateContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleTaskBatchUpdate(
  input: TaskBatchUpdateToolInput,
  ctx: TaskBatchUpdateContext,
) {
  const adapterInputs = input.items.map((it) => ({
    id: it.id,
    patch: it.patch as UpdateTaskInput,
  }));

  const outcome = await ctx.adapter.batchUpdateTasks(adapterInputs);

  if (ctx.cache !== undefined) {
    for (const s of outcome.succeeded) {
      const src = input.items[s.index];
      if (src !== undefined) {
        invalidateTaskMutation(ctx.cache, { taskId: src.id });
      }
    }
  }

  return ok(
    { updated: outcome.succeeded, failed: outcome.failed },
    ctx.makeMeta({ syncPending: outcome.succeeded.length > 0 }),
  );
}

export function registerTaskBatchUpdateTool(server: McpServer, ctx: TaskBatchUpdateContext) {
  return server.registerTool(
    "task_batch_update",
    {
      description: TASK_BATCH_UPDATE_DESCRIPTION,
      inputSchema: taskBatchUpdateInputBaseSchema.shape,
    },
    async (args: TaskBatchUpdateToolInput) => {
      const envelope = await handleTaskBatchUpdate(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
