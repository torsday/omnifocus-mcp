/**
 * `task_batch_assign` MCP tool — apply triage assignments to many tasks in
 * one round trip.
 *
 * Tighter schema than `task_batch_update`: each assignment may set
 * `projectId` (move), `addTagIds`/`removeTagIds` (additive tag diff —
 * resolved via a pre-read), `deferDate`, `dueDate`, `flagged`. Designed for
 * the inbox-triage flow where the agent proposes one assignment per inbox
 * item and the user confirms in a single pass.
 *
 * Atomicity: best-effort, like every other batch tool. OF doesn't expose
 * transactional batches; an item succeeds only when *both* its move (if
 * any) AND its update (if any) succeed. Per-item failures are returned in
 * `failed[]` with `errorCode` prefixed by `"move:"` or `"update:"` so the
 * agent can attribute the failure.
 *
 * @see #475 — initial implementation
 * @see src/prompts/omnifocus.ts — `inbox-triage` prompt that drives this
 * @see src/tools/task/batchUpdate.ts — looser-schema sibling
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { OmniFocusAdapter, UpdateTaskInput } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import type { BatchItemFailure, BatchItemSuccess } from "../../domain/batch.js";
import { ProjectId, TagId, type TaskId, TaskId as TaskIdCtor } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import {
  idempotencyStore as defaultIdempotencyStore,
  type IdempotencyStore,
  withIdempotencyKey,
} from "../../server/idempotencyStore.js";

// ---------------------------------------------------------------------------
// Tool description (DESIGN §6.8 four-section shape)
// ---------------------------------------------------------------------------

export const TASK_BATCH_ASSIGN_DESCRIPTION =
  "Apply inbox-triage style assignments to many tasks in one batch — move to a project, " +
  "diff tags additively, set defer/due/flagged. Tighter schema than task_batch_update; " +
  "designed for the inbox-triage prompt's confirm step. " +
  "Each assignment is { taskId, projectId?, addTagIds?, removeTagIds?, deferDate?, dueDate?, flagged? }. " +
  "Tag diffs are resolved via a pre-read of current tagIds; specifying both addTagIds and removeTagIds " +
  "for the same tag is a no-op (remove wins). " +
  "Atomicity: best-effort, per-item — OF has no transactional batch. An item succeeds only if " +
  "both its move (if requested) AND its non-move update succeed. Failures are reported with " +
  "errorCode prefixed 'move:' or 'update:'. " +
  "Returns { assigned: [{index, value: { id, name }}], failed: [{index, errorCode, message}] } — value carries the task name so the agent can describe each assignment without a follow-up read. " +
  "Do NOT use this tool for full task replacement — use task_update or task_batch_update for those. " +
  "Prefer task_batch_assign over a sequence of single task_update calls when you have a confirmed " +
  "triage plan for multiple tasks. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need changes to appear on other devices. " +
  'Example: task_batch_assign({ assignments: [{ taskId: "abc123", projectId: "prj456", flagged: true }, { taskId: "abc789", addTagIds: ["tag1"] }] })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const assignmentSchema = z
  .object({
    taskId: TaskIdCtor.schema.describe("Persistent task ID."),
    projectId: ProjectId.schema
      .optional()
      .describe("If set, move the task to this project before applying other changes."),
    addTagIds: z
      .array(TagId.schema)
      .optional()
      .describe("Tag IDs to add. Combined with removeTagIds via current-tagIds pre-read."),
    removeTagIds: z
      .array(TagId.schema)
      .optional()
      .describe("Tag IDs to remove. Wins over addTagIds when the same ID appears in both."),
    deferDate: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .optional()
      .describe("Defer date as ISO-8601 with offset. Null clears the date."),
    dueDate: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .optional()
      .describe("Due date as ISO-8601 with offset. Null clears the date."),
    flagged: z.boolean().optional().describe("Flag or unflag the task."),
  })
  .refine(
    (a) =>
      a.projectId !== undefined ||
      a.addTagIds !== undefined ||
      a.removeTagIds !== undefined ||
      a.deferDate !== undefined ||
      a.dueDate !== undefined ||
      a.flagged !== undefined,
    {
      message:
        "Each assignment must set at least one of projectId, addTagIds, removeTagIds, deferDate, dueDate, or flagged",
    },
  );

export const taskBatchAssignInputSchema = z.object({
  assignments: z
    .array(assignmentSchema)
    .min(1)
    .describe("Triage assignments — one per task. Must contain at least one item."),
  idempotency_key: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe(
      "Idempotency key for retry-safe batches. Replays within the TTL window return the cached envelope with meta.idempotentReplay = true. See docs/idempotency.md.",
    ),
});

export type TaskBatchAssignInput = z.infer<typeof taskBatchAssignInputSchema>;
type Assignment = TaskBatchAssignInput["assignments"][number];

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface TaskBatchAssignContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
  /** Optional idempotency-store override (#980). Defaults to module singleton. */
  idempotencyStore?: IdempotencyStore;
}

// ---------------------------------------------------------------------------
// Helpers — pure, exported for testing
// ---------------------------------------------------------------------------

/** Indices of assignments that need a project move. */
function indicesNeedingMove(assignments: readonly Assignment[]): number[] {
  return assignments.map((a, i) => (a.projectId !== undefined ? i : -1)).filter((i) => i >= 0);
}

/** Indices of assignments that need an additive-tag-diff pre-read. */
function indicesNeedingTagPreread(assignments: readonly Assignment[]): number[] {
  return assignments
    .map((a, i) => (a.addTagIds !== undefined || a.removeTagIds !== undefined ? i : -1))
    .filter((i) => i >= 0);
}

/**
 * Compose the new full tagId set from a current set + add/remove diffs.
 * `removeTagIds` wins when a tag appears in both — matches single-task
 * `task_update` semantics.
 */
export function applyTagDiff(
  currentTagIds: readonly TagId[],
  addTagIds: readonly TagId[] | undefined,
  removeTagIds: readonly TagId[] | undefined,
): TagId[] {
  const set = new Set(currentTagIds.map(String));
  for (const t of addTagIds ?? []) set.add(String(t));
  for (const t of removeTagIds ?? []) set.delete(String(t));
  return Array.from(set).map((s) => TagId.of(s));
}

/**
 * Build the patch (a `task_batch_update`-shaped UpdateTaskInput) for one
 * assignment, given its resolved current tagIds. Returns `null` when there's
 * nothing besides a project move to do (no patch needed).
 */
export function buildPatchForAssignment(
  a: Assignment,
  currentTagIds: readonly TagId[] | undefined,
): UpdateTaskInput | null {
  const patch: UpdateTaskInput = {};
  if (a.deferDate !== undefined) patch.deferDate = a.deferDate;
  if (a.dueDate !== undefined) patch.dueDate = a.dueDate;
  if (a.flagged !== undefined) patch.flagged = a.flagged;
  if (a.addTagIds !== undefined || a.removeTagIds !== undefined) {
    patch.tagIds = applyTagDiff(currentTagIds ?? [], a.addTagIds, a.removeTagIds);
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleTaskBatchAssign(
  input: TaskBatchAssignInput,
  ctx: TaskBatchAssignContext,
) {
  const store = ctx.idempotencyStore ?? defaultIdempotencyStore;
  const exec = async () => {
    const assignments = input.assignments;

    // Pre-fetch all task names so the success rows can pair { id, name }
    // per #597 (lever 4). Single round trip; one task fetch covers the whole
    // batch regardless of which phases each item touches.
    const allIds = assignments.map((a) => a.taskId);
    const allTasks = await ctx.adapter.getTasksMany(allIds);
    const nameById = new Map<string, string>();
    for (let i = 0; i < allIds.length; i++) {
      const t = allTasks[i];
      if (t !== null && t !== undefined) {
        nameById.set(allIds[i] as string, t.name);
      }
    }

    // Phase 0: pre-read current tagIds for additive-diff items.
    const tagPrereadIdxs = indicesNeedingTagPreread(assignments);
    const currentTagsByOrigIdx = new Map<number, TagId[]>();
    if (tagPrereadIdxs.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: tagPrereadIdxs contains only valid assignment indices
      const ids = tagPrereadIdxs.map((i) => assignments[i]!.taskId);
      const tasks = await ctx.adapter.getTasksMany(ids);
      for (let k = 0; k < tagPrereadIdxs.length; k++) {
        const t = tasks[k];
        // biome-ignore lint/style/noNonNullAssertion: k is always a valid tagPrereadIdxs index
        if (t) currentTagsByOrigIdx.set(tagPrereadIdxs[k]!, t.tagIds);
      }
    }

    // Phase 1: batch-move items with projectId.
    const moveIdxs = indicesNeedingMove(assignments);
    const moveOutcome =
      moveIdxs.length > 0
        ? await ctx.adapter.batchMoveTasks(
            moveIdxs.map((i) => ({
              // biome-ignore lint/style/noNonNullAssertion: moveIdxs contains only valid assignment indices
              id: assignments[i]!.taskId,
              // biome-ignore lint/style/noNonNullAssertion: indicesNeedingMove guarantees projectId is present
              destination: { projectId: assignments[i]!.projectId! },
            })),
          )
        : { succeeded: [], failed: [] };

    /** Map original-index → "ok" | failure-detail for the move phase. Items not in this map didn't request a move. */
    const moveResultByOrigIdx = new Map<number, "ok" | { errorCode: string; message: string }>();
    for (const s of moveOutcome.succeeded) {
      // biome-ignore lint/style/noNonNullAssertion: s.index is always a valid moveIdxs index
      const origIdx = moveIdxs[s.index]!;
      moveResultByOrigIdx.set(origIdx, "ok");
    }
    for (const f of moveOutcome.failed) {
      // biome-ignore lint/style/noNonNullAssertion: f.index is always a valid moveIdxs index
      const origIdx = moveIdxs[f.index]!;
      moveResultByOrigIdx.set(origIdx, { errorCode: f.errorCode, message: f.message });
    }

    // Phase 2: batch-update items whose move did NOT fail (or that didn't need a move) AND have a non-move patch.
    const updateBatch: Array<{ origIdx: number; id: TaskId; patch: UpdateTaskInput }> = [];
    for (let i = 0; i < assignments.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: loop index is always within assignments bounds
      const a = assignments[i]!;
      const moveRes = moveResultByOrigIdx.get(i);
      if (moveRes !== undefined && moveRes !== "ok") continue; // move failed → skip update
      const patch = buildPatchForAssignment(a, currentTagsByOrigIdx.get(i));
      if (patch !== null) updateBatch.push({ origIdx: i, id: a.taskId, patch });
    }

    const updateOutcome =
      updateBatch.length > 0
        ? await ctx.adapter.batchUpdateTasks(updateBatch.map((u) => ({ id: u.id, patch: u.patch })))
        : { succeeded: [], failed: [] };

    const updateOkBatchIdxs = new Set(updateOutcome.succeeded.map((s) => s.index));
    const updateFailureByBatchIdx = new Map<number, { errorCode: string; message: string }>();
    for (const f of updateOutcome.failed) {
      updateFailureByBatchIdx.set(f.index, { errorCode: f.errorCode, message: f.message });
    }

    // Phase 3: combine outcomes back to original-index space.
    const succeeded: BatchItemSuccess<TaskId>[] = [];
    const failed: BatchItemFailure[] = [];

    for (let i = 0; i < assignments.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: loop index is always within assignments bounds
      const a = assignments[i]!;
      const moveRes = moveResultByOrigIdx.get(i); // undefined = no move requested

      // Move failed → cascade
      if (moveRes !== undefined && moveRes !== "ok") {
        failed.push({
          index: i,
          errorCode: `move:${moveRes.errorCode}`,
          message: moveRes.message,
        });
        continue;
      }

      // Find this item's update outcome (if any)
      const batchIdx = updateBatch.findIndex((u) => u.origIdx === i);
      if (batchIdx >= 0) {
        if (updateOkBatchIdxs.has(batchIdx)) {
          succeeded.push({ index: i, value: a.taskId });
        } else if (updateFailureByBatchIdx.has(batchIdx)) {
          // biome-ignore lint/style/noNonNullAssertion: has(batchIdx) checked above
          const f = updateFailureByBatchIdx.get(batchIdx)!;
          failed.push({ index: i, errorCode: `update:${f.errorCode}`, message: f.message });
        }
        // (No outcome found is impossible — the adapter contract guarantees
        // every batch index appears in succeeded XOR failed.)
      } else {
        // Move-only success or no-op (refine prevents truly-empty assignments).
        succeeded.push({ index: i, value: a.taskId });
      }
    }

    if (ctx.cache !== undefined && succeeded.length > 0) {
      for (const s of succeeded) {
        // biome-ignore lint/style/noNonNullAssertion: s.index is always a valid assignments index
        const a = assignments[s.index]!;
        // Invalidate under the OLD project/parent (from the pre-fetch)…
        const task = allTasks[s.index];
        invalidateTaskMutation(ctx.cache, {
          taskId: a.taskId,
          ...(task !== null &&
            task !== undefined && { projectId: task.projectId, parentId: task.parentId }),
        });
        // …and under the NEW project if the item moved — mirrors task_move.
        if (a.projectId !== undefined && a.projectId !== task?.projectId) {
          invalidateTaskMutation(ctx.cache, { projectId: a.projectId });
        }
      }
    }

    const assigned = succeeded.map((s) => ({
      index: s.index,
      value: { id: s.value, name: nameById.get(s.value as string) ?? "" },
    }));

    return ok({ assigned, failed }, ctx.makeMeta({ syncPending: succeeded.length > 0 }));
  };
  return (await withIdempotencyKey(store, input.idempotency_key, exec)) as Awaited<
    ReturnType<typeof exec>
  >;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskBatchAssignTool(server: McpServer, ctx: TaskBatchAssignContext) {
  return server.registerTool(
    "task_batch_assign",
    {
      description: TASK_BATCH_ASSIGN_DESCRIPTION,
      inputSchema: taskBatchAssignInputSchema.shape,
    },
    async (args: TaskBatchAssignInput) => {
      const envelope = await handleTaskBatchAssign(args, ctx);
      return toolResponse(envelope);
    },
  );
}
