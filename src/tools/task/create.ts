/**
 * `task_create` MCP tool — create a new OmniFocus task.
 *
 * Adopts the idempotency-key safety primitive (#138) so transport retries
 * cannot produce duplicate tasks — the primary motivating use case from
 * #138's problem statement. `expectedModifiedAt` is N/A (no prior version)
 * and `dry_run` is deferred because task_create's return shape is `{ id }`
 * and OmniFocus generates the id server-side — preview would need a
 * sentinel id or a breaking shape change. See #250.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/tools/task/update.ts — task_update (patch editable fields)
 * @see src/tools/task/delete.ts — trio composition reference
 * @see docs/domain-reference.md — inbox vs project vs subtask placement
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CreateTaskInput, OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { ProjectId, TagId, TaskId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import {
  idempotencyStore as defaultIdempotencyStore,
  type IdempotencyStore,
  withIdempotencyKey,
} from "../../server/idempotencyStore.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_CREATE_DESCRIPTION =
  "Create a new task in OmniFocus — in the inbox, inside a project, or as a subtask of another task. " +
  "Supply exactly one of: projectId (project task), parentTaskId (subtask), or neither (inbox). " +
  "Do not use for bulk creation; prefer task_batch_create for that. " +
  "Safety control: pass idempotency_key to make transport retries safe — identical subsequent " +
  "calls within the TTL window replay the original envelope with meta.idempotentReplay = true " +
  "instead of creating a duplicate task. " +
  "Returns the new task's id. " +
  "Side effects: creates a task in OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need the task to appear on other devices.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Base object schema — used for MCP tool registration (.shape is accessible).
 * The SDK needs individual field descriptors; ZodEffects from .refine() lacks .shape.
 */
const taskCreateInputBaseSchema = z.object({
  name: z.string().min(1).describe("Task name. Required, must be non-empty."),

  // Target: at most one of projectId or parentTaskId; neither = inbox
  projectId: ProjectId.schema
    .optional()
    .describe("Project to add the task to. Omit for inbox or subtask."),
  parentTaskId: TaskId.schema
    .optional()
    .describe("Parent task ID for a subtask. Omit for inbox or project task."),

  // Optional fields
  note: z.string().optional().describe("Plain-text note."),
  flagged: z.boolean().optional().describe("Flag the task."),
  dueDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("Due date as ISO-8601 with offset."),
  deferDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("Defer date as ISO-8601 with offset."),
  estimatedMinutes: z.number().int().min(1).optional().describe("Estimated duration in minutes."),
  tagIds: z.array(TagId.schema).optional().describe("Tag IDs to apply."),
  sequential: z.boolean().optional().describe("If true, subtasks must be completed in order."),
  completedByChildren: z.boolean().optional().describe("Complete when all subtasks complete."),

  // Safety-primitive control (#250 / #138)
  idempotency_key: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe(
      "Idempotency key for retry-safe creates. Identical subsequent calls within " +
        "the TTL window replay the original envelope with meta.idempotentReplay = true " +
        "instead of creating a duplicate task.",
    ),
});

/**
 * Full input schema with cross-field refinement.
 * The base schema's `.shape` is used for MCP tool registration so the SDK
 * can read individual field descriptors (ZodEffects from `.refine()` lacks `.shape`).
 */
export const taskCreateInputSchema = taskCreateInputBaseSchema
  .refine((v) => !(v.projectId !== undefined && v.parentTaskId !== undefined), {
    message: "Supply at most one of projectId or parentTaskId",
    path: ["projectId"],
  })
  .refine(
    (v) =>
      !(
        v.dueDate !== undefined &&
        v.deferDate !== undefined &&
        new Date(v.dueDate) < new Date(v.deferDate)
      ),
    { message: "dueDate must not be earlier than deferDate", path: ["dueDate"] },
  );

export type TaskCreateToolInput = z.infer<typeof taskCreateInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskCreateContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
  /**
   * Optional idempotency store override. Defaults to the module singleton.
   * Tests inject a scoped store so parallel specs do not share keys.
   */
  idempotencyStore?: IdempotencyStore;
}

/**
 * Pure handler for `task_create`.
 *
 * Wraps the create in `withIdempotencyKey` so retries under the same key
 * replay the original envelope instead of producing a duplicate task.
 *
 * @throws {NotFound} when projectId or parentTaskId does not exist
 * @throws {OmniFocusNotRunning} when OmniFocus is not running
 */
export async function handleTaskCreate(input: TaskCreateToolInput, ctx: TaskCreateContext) {
  const store = ctx.idempotencyStore ?? defaultIdempotencyStore;

  return withIdempotencyKey(store, input.idempotency_key, async () => {
    const taskInput: CreateTaskInput = {
      name: input.name,
      ...(input.projectId !== undefined && { projectId: input.projectId }),
      ...(input.parentTaskId !== undefined && { parentId: input.parentTaskId }),
      ...(input.note !== undefined && { note: input.note }),
      ...(input.flagged !== undefined && { flagged: input.flagged }),
      ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
      ...(input.deferDate !== undefined && { deferDate: input.deferDate }),
      ...(input.estimatedMinutes !== undefined && { estimatedMinutes: input.estimatedMinutes }),
      ...(input.tagIds !== undefined && { tagIds: input.tagIds }),
      ...(input.sequential !== undefined && { sequential: input.sequential }),
      ...(input.completedByChildren !== undefined && {
        completedByChildren: input.completedByChildren,
      }),
    };
    const id = await ctx.adapter.createTask(taskInput);
    if (ctx.cache !== undefined) {
      invalidateTaskMutation(ctx.cache, {
        ...(input.projectId !== undefined && { projectId: input.projectId }),
      });
    }
    return ok({ id }, ctx.makeMeta({ syncPending: true }));
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskCreateTool(server: McpServer, ctx: TaskCreateContext) {
  return server.registerTool(
    "task_create",
    { description: TASK_CREATE_DESCRIPTION, inputSchema: taskCreateInputBaseSchema.shape },
    async (args: TaskCreateToolInput) => {
      const envelope = await handleTaskCreate(args, ctx);
      return toolResponse(envelope);
    },
  );
}
