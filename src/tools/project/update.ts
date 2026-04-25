/**
 * `project_update` MCP tool — partial-patch update for OmniFocus projects.
 *
 * Only supplied fields are changed; omit a field to leave it unchanged.
 * Pass null for nullable fields (note, deferDate, dueDate, estimatedMinutes,
 * reviewIntervalDays) to clear them.
 *
 * Like the `*_delete` tools and `task_update`, `project_update` composes the
 * three safety primitives — optimistic concurrency (`expectedModifiedAt`),
 * dry-run preview (`dry_run`), and idempotent replay (`idempotency_key`).
 * See #246.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/tools/project/create.ts — project_create (initial creation)
 * @see src/tools/task/update.ts — task_update (dual for tasks)
 * @see docs/domain-reference.md — project schema
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter, UpdateProjectInput } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateProjectMutation } from "../../cache/invalidation.js";
import type { ProjectId as ProjectIdType } from "../../domain/ids.js";
import { ProjectId, TagId } from "../../domain/ids.js";
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

export const PROJECT_UPDATE_DESCRIPTION =
  "Partially update mutable fields on an OmniFocus project. " +
  "Only supplied fields are changed; omit a field to leave it unchanged. " +
  "Pass null for note, deferDate, dueDate, estimatedMinutes, or reviewIntervalDays to clear those fields. " +
  "Safety controls: set dry_run=true to preview without mutating; pass expectedModifiedAt " +
  "(from a recent project_get) to reject the call if the project changed since you read it; " +
  "pass idempotency_key to coalesce retries so the same update is only performed once. " +
  "Returns { updated: true, id }. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need changes to appear on other devices.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const projectUpdateInputSchema = z.object({
  id: ProjectId.schema.describe("Persistent project ID. Get from project_list or project_get."),
  name: z.string().min(1).optional().describe("New project name. Must be non-empty if supplied."),
  note: z.string().nullable().optional().describe("Plain-text note. Pass null to clear."),
  noteHtml: z
    .string()
    .nullable()
    .optional()
    .describe("HTML note. Pass null to clear. Prefer note for plain-text edits."),
  status: z
    .enum(["active", "on-hold"])
    .optional()
    .describe("Project status. Use project_complete or project_drop to close a project."),
  completionCriterion: z
    .enum(["parallel", "sequential", "singleActions"])
    .optional()
    .describe("How the project's tasks are completed."),
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
    .describe("Estimated total duration in minutes. Pass null to clear."),
  flagged: z.boolean().optional().describe("Flag or unflag the project."),
  tagIds: z
    .array(TagId.schema)
    .optional()
    .describe("Full-replacement tag list. Replaces all existing tags."),
  reviewIntervalDays: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("Review interval in days. Pass null to clear."),

  // Safety-primitive controls (#246)
  expectedModifiedAt: z
    .string()
    .optional()
    .describe(
      "Optimistic-concurrency guard: ISO-8601 timestamp from a recent project_get. " +
        "If the project's current modifiedAt differs, the call fails with OF_CONFLICT " +
        "and no update is performed. Omit to skip the check.",
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
      "Idempotency key for retry-safe updates. Identical subsequent calls within " +
        "the TTL window replay the original envelope with meta.idempotentReplay = true " +
        "instead of re-applying the patch.",
    ),
});

export type ProjectUpdateToolInput = z.infer<typeof projectUpdateInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface ProjectUpdateContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /**
   * Optional cache; when supplied, `invalidateProjectMutation` flushes the
   * scopes in the per-mutation matrix after the adapter call succeeds.
   */
  cache?: InvalidatingCache;
  /**
   * Optional idempotency store override. Defaults to the module singleton.
   * Tests inject a scoped store so parallel specs do not share keys.
   */
  idempotencyStore?: IdempotencyStore;
}

type ProjectUpdateData = { updated: true; id: ProjectIdType };

/**
 * Pure handler for `project_update`.
 *
 * Mirrors the `task_update` composition (#244):
 *   1. `withIdempotencyKey` wraps the whole flow so retries replay the first
 *      call's envelope verbatim.
 *   2. Pre-fetch the project — surfaces `NotFound` and yields `modifiedAt`.
 *   3. `assertNotModifiedSince` — throws `ConflictError` if stale; a no-op
 *      when `expectedModifiedAt` is omitted.
 *   4. `dryRunGuard(preview, live)` either returns a preview envelope
 *      (no adapter call, no cache invalidation) or executes the live patch.
 *
 * @throws {NotFound} when the project ID or any tag ID does not exist
 * @throws {ConflictError} when expectedModifiedAt is stale
 * @throws {OmniFocusNotRunning} when OmniFocus is not running
 */
export async function handleProjectUpdate(
  input: ProjectUpdateToolInput,
  ctx: ProjectUpdateContext,
): Promise<ToolEnvelope<ProjectUpdateData>> {
  const { id, ...rest } = input;
  const store = ctx.idempotencyStore ?? defaultIdempotencyStore;

  return withIdempotencyKey(store, input.idempotency_key, async () => {
    const project = await ctx.adapter.getProject(id);
    assertNotModifiedSince(input.expectedModifiedAt, project.modifiedAt, `project:${id}`);

    const patch: UpdateProjectInput = {
      ...(rest.name !== undefined && { name: rest.name }),
      ...(rest.note !== undefined && { note: rest.note }),
      ...(rest.noteHtml !== undefined && { noteHtml: rest.noteHtml }),
      ...(rest.status !== undefined && { status: rest.status }),
      ...(rest.completionCriterion !== undefined && {
        completionCriterion: rest.completionCriterion,
      }),
      ...(rest.deferDate !== undefined && { deferDate: rest.deferDate }),
      ...(rest.dueDate !== undefined && { dueDate: rest.dueDate }),
      ...(rest.estimatedMinutes !== undefined && { estimatedMinutes: rest.estimatedMinutes }),
      ...(rest.flagged !== undefined && { flagged: rest.flagged }),
      ...(rest.tagIds !== undefined && { tagIds: rest.tagIds }),
      ...(rest.reviewIntervalDays !== undefined && {
        reviewIntervalDays: rest.reviewIntervalDays,
      }),
    };

    const preview = (): ToolEnvelope<ProjectUpdateData> =>
      ok({ updated: true as const, id }, ctx.makeMeta({ syncPending: false }));

    const live = async (): Promise<ToolEnvelope<ProjectUpdateData>> => {
      await ctx.adapter.updateProject(id, patch);
      if (ctx.cache !== undefined) {
        invalidateProjectMutation(ctx.cache, { projectId: id });
      }
      return ok({ updated: true as const, id }, ctx.makeMeta({ syncPending: true }));
    };

    return dryRunGuard(input.dry_run, preview, live);
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProjectUpdateTool(server: McpServer, ctx: ProjectUpdateContext) {
  return server.registerTool(
    "project_update",
    { description: PROJECT_UPDATE_DESCRIPTION, inputSchema: projectUpdateInputSchema.shape },
    async (args: ProjectUpdateToolInput) => {
      const envelope = await handleProjectUpdate(args, ctx);
      return toolResponse(envelope);
    },
  );
}
