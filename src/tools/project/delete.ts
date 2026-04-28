/**
 * `project_delete` MCP tool — hard (unrecoverable) removal of an OmniFocus project.
 *
 * This is a destructive, irreversible operation. OmniFocus's `deleteObject`
 * API permanently removes the project AND all its contained tasks from the
 * database with no undo. Prefer `project_drop` when you want a recoverable
 * status change that keeps the project accessible.
 *
 * Because the cascade blast radius exceeds `task_delete`, the tool composes
 * all three safety primitives on the same `task_delete` (#240) pattern:
 * optimistic concurrency (`expectedModifiedAt`), dry-run preview (`dry_run`),
 * and idempotent replay (`idempotency_key`). See #242.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/tools/task/delete.ts — task_delete (equivalent for tasks; reference slice)
 * @see docs/domain-reference.md — drop vs. delete distinction
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateProjectMutation } from "../../cache/invalidation.js";
import type { ProjectId as ProjectIdType } from "../../domain/ids.js";
import { ProjectId } from "../../domain/ids.js";
import { summaryProjectDelete } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, type ToolEnvelope, toolResponse } from "../../envelope/index.js";
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

export const PROJECT_DELETE_DESCRIPTION =
  "Permanently delete an OmniFocus project and ALL its contained tasks. " +
  "IRREVERSIBLE — uses OmniFocus deleteObject; there is no undo. " +
  "All tasks inside the project are also permanently deleted (cascade). " +
  "Prefer project_drop when you want a recoverable status change. " +
  "Only use project_delete when the agent has explicit user intent to permanently remove the project and its tasks. " +
  "Safety controls: set dry_run=true to preview without mutating; pass expectedModifiedAt " +
  "(from a recent project_get) to reject the call if the project changed since you read it; " +
  "pass idempotency_key to coalesce retries so the same delete is only performed once. " +
  "Returns { deleted: true, id } on success. " +
  "Side effects: removes the project and its tasks from OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need the deletion to appear on other devices. " +
  'Example: project_delete({ id: "prj123", dry_run: true }) ' +
  'Example: project_delete({ id: "prj123", expectedModifiedAt: "2026-04-01T10:00:00Z" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const projectDeleteInputSchema = z.object({
  id: ProjectId.schema.describe(
    "Persistent ID of the project to delete. Get from project_list. " +
      "Verify you have the correct ID before calling — this action is irreversible " +
      "and deletes all contained tasks.",
  ),
  expectedModifiedAt: z
    .string()
    .optional()
    .describe(
      "Optimistic-concurrency guard: ISO-8601 timestamp from a recent project_get. " +
        "If the project's current modifiedAt differs, the call fails with OF_CONFLICT " +
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

export type ProjectDeleteToolInput = z.infer<typeof projectDeleteInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface ProjectDeleteContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /**
   * Optional cache; when supplied, `invalidateProjectMutation` flushes the
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

type ProjectDeleteData = { deleted: true; id: ProjectIdType };

/**
 * Pure handler for `project_delete`.
 *
 * Mirrors the `task_delete` composition (#240):
 *   1. `withIdempotencyKey` wraps the whole flow, so replays return the
 *      first call's envelope verbatim even after the project is gone.
 *   2. Pre-fetch surfaces NotFound and yields the current `modifiedAt`.
 *   3. `assertNotModifiedSince` throws `ConflictError` on stale guards.
 *   4. `dryRunGuard(preview, live)` either returns a preview envelope
 *      (no adapter call, no cache invalidation) or executes the live delete.
 *
 * @throws {NotFound} when the project ID does not exist
 * @throws {ConflictError} when expectedModifiedAt is stale
 * @throws {OmniFocusNotRunning} when OmniFocus is not running
 */
export async function handleProjectDelete(
  input: ProjectDeleteToolInput,
  ctx: ProjectDeleteContext,
): Promise<ToolEnvelope<ProjectDeleteData>> {
  const store = ctx.idempotencyStore ?? defaultIdempotencyStore;

  return withIdempotencyKey(store, input.idempotency_key, async () => {
    const project = await ctx.adapter.getProject(input.id);
    assertNotModifiedSince(input.expectedModifiedAt, project.modifiedAt, `project:${input.id}`);

    const preview = (): ToolEnvelope<ProjectDeleteData> =>
      ok({ deleted: true as const, id: input.id }, ctx.makeMeta({ syncPending: false }));

    const live = async (): Promise<ToolEnvelope<ProjectDeleteData>> => {
      await ctx.adapter.deleteProject(input.id);
      if (ctx.cache !== undefined) {
        invalidateProjectMutation(ctx.cache, { projectId: input.id });
      }
      return ok(
        { deleted: true as const, id: input.id },
        ctx.makeMeta({
          syncPending: true,
          humanReadableSummary: summaryProjectDelete(project.name),
        }),
      );
    };

    return dryRunGuard(input.dry_run, preview, live);
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProjectDeleteTool(server: McpServer, ctx: ProjectDeleteContext) {
  return server.registerTool(
    "project_delete",
    { description: PROJECT_DELETE_DESCRIPTION, inputSchema: projectDeleteInputSchema.shape },
    async (args: ProjectDeleteToolInput) => {
      const envelope = await handleProjectDelete(args, ctx);
      return toolResponse(envelope);
    },
  );
}
