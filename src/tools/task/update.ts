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
 * Like the `*_delete` tools, `task_update` composes the three safety
 * primitives — optimistic concurrency (`expectedModifiedAt`), dry-run
 * preview (`dry_run`), and idempotent replay (`idempotency_key`). See #244.
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
import { NAME_MAX_CHARS } from "../../domain/inputLimits.js";
import type { Task } from "../../domain/task.js";
import { ok, type ResponseMeta, type ToolEnvelope, toolResponse } from "../../envelope/index.js";
import { validateRefined } from "../../errors/validateRefined.js";
import { assertNotModifiedSince } from "../../server/assertNotModifiedSince.js";
import { dryRunGuard } from "../../server/dryRunGuard.js";
import {
  idempotencyStore as defaultIdempotencyStore,
  type IdempotencyStore,
  withIdempotencyKey,
} from "../../server/idempotencyStore.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_UPDATE_DESCRIPTION =
  "Partially update mutable fields on an OmniFocus task. " +
  "Only supplied fields are changed; omit a field to leave it unchanged. " +
  "Do not use to complete or delete a task; prefer task_complete or task_delete instead. " +
  "Two tag-update modes: (1) supply tagIds to replace the full tag set; " +
  "(2) supply addTags and/or removeTags to apply a diff without reading first. " +
  "Supplying tagIds together with addTags/removeTags is a ValidationError. " +
  "setFlagged is a convenience alias for flagged. " +
  "Safety controls: set dry_run=true to preview the patched task without mutating; " +
  "pass expectedModifiedAt (from a recent task_get) to reject the call if the task " +
  "changed since you read it; pass idempotency_key to coalesce retries so the same " +
  "update is only performed once. " +
  "Returns the updated task. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need changes to appear on other devices. " +
  'Example: task_update({ id: "abc123", flagged: true }) ' +
  'Example: task_update({ id: "abc123", dueDate: "2026-05-01T00:00:00Z", addTags: ["tag456"] })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskUpdateInputBaseSchema = z.object({
  id: TaskId.schema.describe("Persistent task ID. Get from task_list or search_query."),

  // Scalar editable fields
  name: z
    .string()
    .min(1)
    .max(NAME_MAX_CHARS, "max 1 KB")
    .optional()
    .describe("New task name. Must be non-empty if supplied."),
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
  deferDateFloating: z
    .boolean()
    .optional()
    .describe("When true, the defer time is floating (follows the user across time zones)."),
  dueDate: z
    .string()
    .nullable()
    .optional()
    .describe("ISO-8601 due date with UTC offset. Pass null to clear."),
  dueDateFloating: z
    .boolean()
    .optional()
    .describe("When true, the due time is floating (follows the user across time zones)."),
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

  // Safety-primitive controls (#244)
  expectedModifiedAt: z
    .string()
    .optional()
    .describe(
      "Optimistic-concurrency guard: ISO-8601 timestamp from a recent task_get. " +
        "If the task's current modifiedAt differs, the call fails with OF_CONFLICT " +
        "and no update is performed. Omit to skip the check.",
    ),
  dry_run: z
    .boolean()
    .optional()
    .describe(
      "When true, validates input, computes the patched task (pre-fetch merged " +
        "with the supplied fields), and returns a preview envelope with " +
        "meta.dryRun = true; no adapter call is made and no mutation occurs.",
    ),
  idempotency_key: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe(
      "Idempotency key for retry-safe updates. Identical subsequent calls within " +
        "the TTL window replay the original envelope with meta.idempotentReplay = true " +
        "instead of re-applying the patch.",
    ),
});

/**
 * Full input schema with cross-field refinement.
 * The base schema's `.shape` is used for MCP tool registration so the SDK
 * can read individual field descriptors (ZodEffects from `.refine()` lacks `.shape`).
 */
export const taskUpdateInputSchema = taskUpdateInputBaseSchema
  .refine(
    (val) =>
      !(val.tagIds !== undefined && (val.addTags !== undefined || val.removeTags !== undefined)),
    {
      message:
        "tagIds cannot be combined with addTags/removeTags. " +
        "Use tagIds for full replacement, or addTags/removeTags for additive diff.",
      path: ["tagIds"],
    },
  )
  .refine(
    (v) =>
      !(v.dueDate != null && v.deferDate != null && new Date(v.dueDate) < new Date(v.deferDate)),
    { message: "dueDate must not be earlier than deferDate", path: ["dueDate"] },
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
  /**
   * Optional idempotency store override. Defaults to the module singleton.
   * Tests inject a scoped store so parallel specs do not share keys.
   */
  idempotencyStore?: IdempotencyStore;
}

type TaskUpdateData = { task: Task };

/**
 * Pure handler for `task_update`.
 *
 * Order of operations:
 *   1. `withIdempotencyKey` wraps the whole flow so retries replay the first
 *      call's envelope verbatim.
 *   2. Pre-fetch the task — surfaces `NotFound` and yields `modifiedAt` +
 *      the current tag set for additive-diff resolution.
 *   3. `assertNotModifiedSince` — throws `ConflictError` if stale; a no-op
 *      when `expectedModifiedAt` is omitted.
 *   4. Resolve the additive tag diff (if any) against the pre-fetched task
 *      into a final `tagIds` array.
 *   5. `dryRunGuard(preview, live)`:
 *        - `preview` merges the patch onto the pre-fetched task and returns
 *          it as the envelope data. Server-managed fields (`modifiedAt`,
 *          `_links`) are left at their current values — the preview shows
 *          which fields would change, not a forged post-write snapshot.
 *        - `live` calls `adapter.updateTask`, re-fetches the task, and
 *          invalidates cache scopes.
 *
 * @throws {NotFound} when the task ID or any tag ID does not exist
 * @throws {ConflictError} when expectedModifiedAt is stale
 * @throws {OmniFocusNotRunning} when OmniFocus is not running
 */
export async function handleTaskUpdate(
  input: TaskUpdateToolInput,
  ctx: TaskUpdateContext,
): Promise<ToolEnvelope<TaskUpdateData>> {
  // Re-parse against the refined schema — the SDK only validates the base
  // shape, so cross-field rules (tagIds vs addTags/removeTags exclusivity,
  // dueDate ≥ deferDate) need explicit enforcement.
  // See src/errors/validateRefined.ts.
  validateRefined(taskUpdateInputSchema, input);

  const { id, addTags, removeTags, setFlagged, tagIds, ...rest } = input;
  const store = ctx.idempotencyStore ?? defaultIdempotencyStore;

  return withIdempotencyKey(store, input.idempotency_key, async () => {
    const current = await ctx.adapter.getTask(id);
    assertNotModifiedSince(input.expectedModifiedAt, current.modifiedAt, `task:${id}`);

    let resolvedTagIds: typeof tagIds;
    if (addTags !== undefined || removeTags !== undefined) {
      const currentSet = new Set(current.tagIds);
      for (const t of addTags ?? []) currentSet.add(t);
      for (const t of removeTags ?? []) currentSet.delete(t);
      resolvedTagIds = [...currentSet];
    } else if (tagIds !== undefined) {
      resolvedTagIds = tagIds;
    }

    // `setFlagged` is an alias; last-write wins if both are supplied.
    const resolvedFlagged = setFlagged !== undefined ? setFlagged : rest.flagged;

    const patch = {
      ...(rest.name !== undefined ? { name: rest.name } : {}),
      ...(rest.note !== undefined ? { note: rest.note } : {}),
      ...(resolvedFlagged !== undefined ? { flagged: resolvedFlagged } : {}),
      ...(rest.deferDate !== undefined ? { deferDate: rest.deferDate } : {}),
      ...(rest.deferDateFloating !== undefined
        ? { deferDateFloating: rest.deferDateFloating }
        : {}),
      ...(rest.dueDate !== undefined ? { dueDate: rest.dueDate } : {}),
      ...(rest.dueDateFloating !== undefined ? { dueDateFloating: rest.dueDateFloating } : {}),
      ...(rest.estimatedMinutes !== undefined ? { estimatedMinutes: rest.estimatedMinutes } : {}),
      ...(rest.sequential !== undefined ? { sequential: rest.sequential } : {}),
      ...(rest.completedByChildren !== undefined
        ? { completedByChildren: rest.completedByChildren }
        : {}),
      ...(resolvedTagIds !== undefined ? { tagIds: resolvedTagIds } : {}),
    };

    const preview = (): ToolEnvelope<TaskUpdateData> => {
      const patched: Task = { ...current, ...patch };
      return ok({ task: patched }, ctx.makeMeta({ syncPending: false }));
    };

    const live = async (): Promise<ToolEnvelope<TaskUpdateData>> => {
      await ctx.adapter.updateTask(id, patch);
      const task = await ctx.adapter.getTask(id);
      if (ctx.cache !== undefined) {
        invalidateTaskMutation(ctx.cache, { taskId: id, projectId: task.projectId });
      }
      return ok({ task }, ctx.makeMeta({ syncPending: true }));
    };

    return dryRunGuard(input.dry_run, preview, live);
  });
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
      return toolResponse(envelope);
    },
  );
}
