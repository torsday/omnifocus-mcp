/**
 * `task_delete` MCP tool — hard (unrecoverable) removal of an OmniFocus task.
 *
 * This is a destructive, irreversible operation. OmniFocus's `deleteObject`
 * API permanently removes the task from the database with no undo. Prefer
 * `task_drop` when you want a recoverable status change that keeps the task
 * accessible in the database.
 *
 * Because the cost of a mistake is high, `task_delete` is the reference
 * vertical slice that composes all three safety primitives: optimistic
 * concurrency (`expectedModifiedAt`), dry-run preview (`dry_run`), and
 * idempotent replay (`idempotency_key`). See #240.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/tools/task/update.ts — task_update (patch editable fields)
 * @see docs/domain-reference.md — drop vs. delete distinction
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import type { TaskId as TaskIdType } from "../../domain/ids.js";
import { TaskId } from "../../domain/ids.js";
import { type ResponseMeta, type ToolEnvelope, ok } from "../../envelope/index.js";
import { assertNotModifiedSince } from "../../server/assertNotModifiedSince.js";
import { dryRunGuard } from "../../server/dryRunGuard.js";
import {
  type IdempotencyStore,
  idempotencyStore as defaultIdempotencyStore,
  withIdempotencyKey,
} from "../../server/idempotencyStore.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_DELETE_DESCRIPTION =
  "Permanently delete an OmniFocus task. " +
  "IRREVERSIBLE — uses OmniFocus deleteObject; there is no undo. " +
  "Prefer task_drop when you want a recoverable status change. " +
  "Only use task_delete when the agent has explicit user intent to permanently remove the task. " +
  "Safety controls: set dry_run=true to preview without mutating; pass expectedModifiedAt " +
  "(from a recent task_get) to reject the call if the task changed since you read it; " +
  "pass idempotency_key to coalesce retries so the same delete is only performed once. " +
  "Returns { deleted: true, id } on success. " +
  "Side effects: removes the task from OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need the deletion to appear on other devices.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskDeleteInputSchema = z.object({
  id: TaskId.schema.describe(
    "Persistent ID of the task to delete. Get from task_list or search_query. " +
      "Verify you have the correct ID before calling — this action is irreversible.",
  ),
  expectedModifiedAt: z
    .string()
    .optional()
    .describe(
      "Optimistic-concurrency guard: ISO-8601 timestamp from a recent task_get. " +
        "If the task's current modifiedAt differs, the call fails with OF_CONFLICT " +
        "and no delete is performed. Omit to skip the check.",
    ),
  dry_run: z
    .boolean()
    .optional()
    .describe(
      "When true, validates input and returns a preview envelope with " +
        "meta.dryRun = true; no adapter call is made and no mutation occurs.",
    ),
  idempotency_key: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe(
      "Idempotency key for retry-safe deletes. Identical subsequent calls within " +
        "the TTL window replay the original envelope with meta.idempotentReplay = true " +
        "instead of re-deleting (or re-raising NotFound on the second attempt).",
    ),
});

export type TaskDeleteToolInput = z.infer<typeof taskDeleteInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskDeleteContext {
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

type TaskDeleteData = { deleted: true; id: TaskIdType };

/**
 * Pure handler for `task_delete`.
 *
 * Order of operations:
 *   1. Pre-fetch the task (surfaces NotFound, and its `modifiedAt` + `projectId`
 *      are needed for the concurrency guard and cache invalidation).
 *   2. `assertNotModifiedSince` — throws ConflictError if stale; a no-op when
 *      `expectedModifiedAt` is omitted.
 *   3. `withIdempotencyKey` wraps `dryRunGuard`, so replays return the same
 *      envelope whether the original call was a dry-run or a live delete.
 *   4. Live path calls `adapter.deleteTask` and invalidates cache scopes.
 *
 * @throws {NotFound} when the task ID does not exist
 * @throws {ConflictError} when expectedModifiedAt is stale
 * @throws {OmniFocusNotRunning} when OmniFocus is not running
 */
export async function handleTaskDelete(
  input: TaskDeleteToolInput,
  ctx: TaskDeleteContext,
): Promise<ToolEnvelope<TaskDeleteData>> {
  const store = ctx.idempotencyStore ?? defaultIdempotencyStore;

  // Idempotency wraps the pre-fetch so a replay does not need the task to
  // still exist in the adapter — the first call's envelope is returned verbatim.
  return withIdempotencyKey(store, input.idempotency_key, async () => {
    const task = await ctx.adapter.getTask(input.id);
    assertNotModifiedSince(input.expectedModifiedAt, task.modifiedAt, `task:${input.id}`);

    const preview = (): ToolEnvelope<TaskDeleteData> =>
      ok({ deleted: true as const, id: input.id }, ctx.makeMeta({ syncPending: false }));

    const live = async (): Promise<ToolEnvelope<TaskDeleteData>> => {
      await ctx.adapter.deleteTask(input.id);
      if (ctx.cache !== undefined) {
        invalidateTaskMutation(ctx.cache, { taskId: input.id, projectId: task.projectId });
      }
      return ok({ deleted: true as const, id: input.id }, ctx.makeMeta({ syncPending: true }));
    };

    return dryRunGuard(input.dry_run, preview, live);
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskDeleteTool(server: McpServer, ctx: TaskDeleteContext) {
  return server.registerTool(
    "task_delete",
    { description: TASK_DELETE_DESCRIPTION, inputSchema: taskDeleteInputSchema.shape },
    async (args: TaskDeleteToolInput) => {
      const envelope = await handleTaskDelete(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
