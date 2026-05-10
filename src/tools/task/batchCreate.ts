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
import { NAME_MAX_CHARS, NOTE_MAX_CHARS } from "../../domain/inputLimits.js";
import { summaryBatchCreate } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

export const TASK_BATCH_CREATE_DESCRIPTION =
  "Create many OmniFocus tasks in a single JXA round trip. " +
  "Validation is atomic: if any input fails schema, the whole batch is rejected " +
  "before any mutation. Execution is best-effort: once the batch reaches OmniFocus, " +
  "each task succeeds or fails independently, and the response reports per-index outcomes. " +
  "Prefer this tool over repeated task_create calls whenever you are creating more than one task. " +
  "Each item accepts the same shape as task_create (name, optional projectId or parentTaskId, note, " +
  "flagged, dueDate, deferDate, estimatedMinutes, tagIds, sequential, completedByChildren). " +
  "Returns { created: [{index, value: { id, name }}], failed: [{index, errorCode, message}] } — value carries the task name (echoed from the input) so the agent can describe each new task without a follow-up read. " +
  "Side effects: creates tasks in OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need the tasks to appear on other devices. " +
  'Example: task_batch_create({ items: [{ name: "Buy milk" }, { name: "Call dentist", projectId: "prj123" }] })';

const singleItemSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(NAME_MAX_CHARS, "max 1 KB")
      .describe("Task name. Required, non-empty."),
    projectId: ProjectId.schema
      .optional()
      .describe("Project to add the task to. Omit for inbox or subtask."),
    parentTaskId: TaskId.schema
      .optional()
      .describe("Parent task ID for a subtask. Omit for inbox or project task."),
    note: z.string().max(NOTE_MAX_CHARS, "max 1 MB").optional().describe("Plain-text note."),
    flagged: z.boolean().optional().describe("Flag the task."),
    dueDate: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe("Due date as ISO-8601 with offset."),
    dueDateFloating: z
      .boolean()
      .optional()
      .describe("When true, the due time is floating (follows the user across time zones)."),
    deferDate: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe("Defer date as ISO-8601 with offset."),
    deferDateFloating: z
      .boolean()
      .optional()
      .describe("When true, the defer time is floating (follows the user across time zones)."),
    estimatedMinutes: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Estimated duration in minutes."),
    tagIds: z.array(TagId.schema).optional().describe("Tag IDs to apply."),
    sequential: z.boolean().optional().describe("If true, subtasks must be completed in order."),
    completedByChildren: z.boolean().optional().describe("Complete when all subtasks complete."),
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

  // Names come from the input — no fetch needed for this verb.
  const created = outcome.succeeded.map((s) => ({
    index: s.index,
    value: { id: s.value, name: input.items[s.index]?.name ?? "" },
  }));

  return ok(
    { created, failed: outcome.failed },
    ctx.makeMeta({
      syncPending: outcome.succeeded.length > 0,
      humanReadableSummary: summaryBatchCreate(outcome.succeeded.length),
    }),
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
