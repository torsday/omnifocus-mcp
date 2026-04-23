/**
 * `task_update` MCP tool — partial-patch update for OmniFocus tasks.
 *
 * Supports two tag-update modes:
 *  - Full replacement: supply `tagIds` to set the exact final set.
 *  - Additive diff: supply `addTags` and/or `removeTags` to apply a diff on
 *    top of the task's current tags without a read-modify-write race.
 *
 * Supplying `tagIds` alongside `addTags`/`removeTags` is a `ValidationError`
 * (ambiguous intent — the agent must choose one mode per call).
 *
 * `setFlagged` is a convenience alias for the `flagged` field that signals
 * the agent's intent without touching any other field.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see DESIGN.md §32 — additive patch semantics
 * @see src/adapter/OmniFocusAdapter.ts — UpdateTaskInput
 * @see src/tools/task/update.test.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { TagId, TaskId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_UPDATE_DESCRIPTION =
  "Partially update mutable fields on an OmniFocus task. " +
  "Only supplied fields are changed; omit a field to leave it unchanged. " +
  "Two tag-update modes: (1) supply tagIds to replace the full tag set; " +
  "(2) supply addTags and/or removeTags to apply a diff without reading first. " +
  "Supplying tagIds together with addTags/removeTags is a ValidationError. " +
  "setFlagged is a convenience alias for flagged. " +
  "Returns the updated task. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need changes to appear on other devices.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const taskUpdateInputBaseSchema = z.object({
  id: TaskId.schema.describe("Persistent task ID. Get from task_list or search_query."),

  // Scalar editable fields
  name: z.string().min(1).optional().describe("New task name. Must be non-empty if supplied."),
  note: z
    .string()
    .nullable()
    .optional()
    .describe("Plain-text note. Pass null to clear. HTML round-trip available in M3."),
  flagged: z.boolean().optional().describe("Flag or unflag the task. Alias: setFlagged."),
  setFlagged: z
    .boolean()
    .optional()
    .describe(
      "Convenience alias for flagged. " +
        "Use when your intent is specifically to set or clear the flag " +
        "without touching other fields.",
    ),
  deferDate: z
    .string()
    .nullable()
    .optional()
    .describe("ISO-8601 defer date with UTC offset. Pass null to clear."),
  dueDate: z
    .string()
    .nullable()
    .optional()
    .describe("ISO-8601 due date with UTC offset. Pass null to clear."),
  estimatedMinutes: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("Estimated duration in minutes. Pass null to clear."),
  sequential: z.boolean().optional().describe("Whether subtasks must be completed in order."),
  completedByChildren: z
    .boolean()
    .optional()
    .describe("Whether the task completes when all children are complete."),

  // Tag fields — mutually exclusive modes
  tagIds: z
    .array(TagId.schema)
    .optional()
    .describe(
      "Full-replacement tag list. Replaces all existing tags. " +
        "Mutually exclusive with addTags/removeTags.",
    ),
  addTags: z
    .array(TagId.schema)
    .optional()
    .describe(
      "Tags to add. No-op for tags the task already has. " + "Mutually exclusive with tagIds.",
    ),
  removeTags: z
    .array(TagId.schema)
    .optional()
    .describe(
      "Tags to remove. No-op for tags the task doesn't have. " + "Mutually exclusive with tagIds.",
    ),
});

/**
 * Full input schema with cross-field refinement.
 * The base schema's `.shape` is used for MCP tool registration so the SDK
 * can read individual field descriptors (ZodEffects from `.refine()` lacks `.shape`).
 */
export const taskUpdateInputSchema = taskUpdateInputBaseSchema.refine(
  (val) =>
    !(val.tagIds !== undefined && (val.addTags !== undefined || val.removeTags !== undefined)),
  {
    message:
      "tagIds cannot be combined with addTags/removeTags. " +
      "Use tagIds for full replacement, or addTags/removeTags for additive diff.",
    path: ["tagIds"],
  },
);

export type TaskUpdateToolInput = z.infer<typeof taskUpdateInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskUpdateContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /**
   * Optional cache; when supplied, `invalidateTaskMutation` flushes the
   * scopes in the per-mutation matrix (docs/cache-invalidation.md) after
   * the adapter call succeeds.
   */
  cache?: InvalidatingCache;
}

/**
 * Pure handler for `task_update`.
 *
 * Computes the final tag set when additive mode is used, then delegates a
 * single `updateTask` call to the adapter. The additive diff is applied
 * inside the write queue so it is atomic with respect to other mutations.
 *
 * @throws {ValidationError} when tagIds is combined with addTags/removeTags
 * @throws {NotFound} when the task ID or any tag ID does not exist
 */
export async function handleTaskUpdate(input: TaskUpdateToolInput, ctx: TaskUpdateContext) {
  const { id, addTags, removeTags, setFlagged, tagIds, ...rest } = input;

  // Resolve additive tag diff → full tagIds array, fetching current task once
  let resolvedTagIds: typeof tagIds;
  if (addTags !== undefined || removeTags !== undefined) {
    const current = await ctx.adapter.getTask(id);
    const currentSet = new Set(current.tagIds);
    for (const t of addTags ?? []) currentSet.add(t);
    for (const t of removeTags ?? []) currentSet.delete(t);
    resolvedTagIds = [...currentSet];
  } else if (tagIds !== undefined) {
    resolvedTagIds = tagIds;
  }

  // Merge setFlagged into flagged (setFlagged wins if both supplied — schema
  // doesn't forbid it since they're aliases; last-write wins is fine here)
  const resolvedFlagged = setFlagged !== undefined ? setFlagged : rest.flagged;

  await ctx.adapter.updateTask(id, {
    ...(rest.name !== undefined ? { name: rest.name } : {}),
    ...(rest.note !== undefined ? { note: rest.note } : {}),
    ...(resolvedFlagged !== undefined ? { flagged: resolvedFlagged } : {}),
    ...(rest.deferDate !== undefined ? { deferDate: rest.deferDate } : {}),
    ...(rest.dueDate !== undefined ? { dueDate: rest.dueDate } : {}),
    ...(rest.estimatedMinutes !== undefined ? { estimatedMinutes: rest.estimatedMinutes } : {}),
    ...(rest.sequential !== undefined ? { sequential: rest.sequential } : {}),
    ...(rest.completedByChildren !== undefined
      ? { completedByChildren: rest.completedByChildren }
      : {}),
    ...(resolvedTagIds !== undefined ? { tagIds: resolvedTagIds } : {}),
  });

  const task = await ctx.adapter.getTask(id);
  if (ctx.cache !== undefined) {
    invalidateTaskMutation(ctx.cache, { taskId: id, projectId: task.projectId });
  }
  return ok({ task }, ctx.makeMeta({ syncPending: true }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskUpdateTool(server: McpServer, ctx: TaskUpdateContext) {
  return server.registerTool(
    "task_update",
    { description: TASK_UPDATE_DESCRIPTION, inputSchema: taskUpdateInputBaseSchema.shape },
    async (args: TaskUpdateToolInput) => {
      const envelope = await handleTaskUpdate(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
