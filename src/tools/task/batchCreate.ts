/**
 * `task_batch_create` MCP tool — create many tasks in a single round trip.
 *
 * Atomic validation (schema failures reject the whole batch before any
 * mutation) + best-effort execution (per-item success/failure once the
 * batch reaches OmniFocus). The adapter performs exactly one JXA round
 * trip regardless of batch size; that single-round-trip guarantee is the
 * entire point of this tool vs calling `task_create` in a loop.
 *
 * @see src/tools/task/create.ts — singular counterpart
 * @see src/domain/batch.ts — BatchOutcome shape
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CreateTaskInput, OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { ProjectId, TagId, TaskId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

export const TASK_BATCH_CREATE_DESCRIPTION =
  "Create many OmniFocus tasks in a single JXA round trip. " +
  "Validation is atomic: if any input fails schema, the whole batch is rejected " +
  "before any mutation. Execution is best-effort: once the batch reaches OmniFocus, " +
  "each task succeeds or fails independently, and the response reports per-index outcomes. " +
  "Prefer this tool over repeated task_create calls whenever you are creating more than one task. " +
  "Each item accepts the same shape as task_create (name, optional projectId or parentTaskId, note, " +
  "flagged, dueDate, deferDate, estimatedMinutes, tagIds, sequential, completedByChildren). " +
  "Returns { created: [{index, value: taskId}], failed: [{index, errorCode, message}] }. " +
  "Side effects: creates tasks in OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need the tasks to appear on other devices.";

const singleItemSchema = z
  .object({
    name: z.string().min(1).describe("Task name. Required, non-empty."),
    projectId: ProjectId.schema
      .optional()
      .describe("Project to add the task to. Omit for inbox or subtask."),
    parentTaskId: TaskId.schema
      .optional()
      .describe("Parent task ID for a subtask. Omit for inbox or project task."),
    note: z.string().optional(),
    flagged: z.boolean().optional(),
    dueDate: z.string().datetime({ offset: true }).optional(),
    dueDateFloating: z.boolean().optional(),
    deferDate: z.string().datetime({ offset: true }).optional(),
    deferDateFloating: z.boolean().optional(),
    estimatedMinutes: z.number().int().positive().optional(),
    tagIds: z.array(TagId.schema).optional(),
    sequential: z.boolean().optional(),
    completedByChildren: z.boolean().optional(),
  })
  .refine((v) => !(v.projectId !== undefined && v.parentTaskId !== undefined), {
    message: "Supply at most one of projectId or parentTaskId",
    path: ["projectId"],
  });

export const taskBatchCreateInputBaseSchema = z.object({
  items: z
    .array(singleItemSchema)
    .min(1)
    .describe("Array of task inputs. Must contain at least one item."),
});

export type TaskBatchCreateToolInput = z.infer<typeof taskBatchCreateInputBaseSchema>;

export interface TaskBatchCreateContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleTaskBatchCreate(
  input: TaskBatchCreateToolInput,
  ctx: TaskBatchCreateContext,
) {
  const adapterInputs: CreateTaskInput[] = input.items.map((it) => ({
    name: it.name,
    ...(it.projectId !== undefined && { projectId: it.projectId }),
    ...(it.parentTaskId !== undefined && { parentId: it.parentTaskId }),
    ...(it.note !== undefined && { note: it.note }),
    ...(it.flagged !== undefined && { flagged: it.flagged }),
    ...(it.dueDate !== undefined && { dueDate: it.dueDate }),
    ...(it.dueDateFloating !== undefined && { dueDateFloating: it.dueDateFloating }),
    ...(it.deferDate !== undefined && { deferDate: it.deferDate }),
    ...(it.deferDateFloating !== undefined && { deferDateFloating: it.deferDateFloating }),
    ...(it.estimatedMinutes !== undefined && { estimatedMinutes: it.estimatedMinutes }),
    ...(it.tagIds !== undefined && { tagIds: it.tagIds }),
    ...(it.sequential !== undefined && { sequential: it.sequential }),
    ...(it.completedByChildren !== undefined && { completedByChildren: it.completedByChildren }),
  }));

  const outcome = await ctx.adapter.batchCreateTasks(adapterInputs);

  if (ctx.cache !== undefined && outcome.succeeded.length > 0) {
    const seen = new Set<string>();
    for (const s of outcome.succeeded) {
      const src = input.items[s.index];
      const pid = src?.projectId;
      if (pid !== undefined && !seen.has(pid)) {
        seen.add(pid);
        invalidateTaskMutation(ctx.cache, { projectId: pid });
      }
    }
    if (seen.size === 0) invalidateTaskMutation(ctx.cache, {});
  }

  return ok(
    { created: outcome.succeeded, failed: outcome.failed },
    ctx.makeMeta({ syncPending: outcome.succeeded.length > 0 }),
  );
}

export function registerTaskBatchCreateTool(server: McpServer, ctx: TaskBatchCreateContext) {
  return server.registerTool(
    "task_batch_create",
    {
      description: TASK_BATCH_CREATE_DESCRIPTION,
      inputSchema: taskBatchCreateInputBaseSchema.shape,
    },
    async (args: TaskBatchCreateToolInput) => {
      const envelope = await handleTaskBatchCreate(args, ctx);
      return toolResponse(envelope);
    },
  );
}
