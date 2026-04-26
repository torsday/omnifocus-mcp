/**
 * `project_create` MCP tool — create a new OmniFocus project.
 *
 * Adopts the idempotency-key safety primitive (#138) so transport retries
 * cannot produce duplicate projects. `expectedModifiedAt` is N/A (no prior
 * version) and `dry_run` is deferred — the `{ created, id }` return shape
 * has no preview equivalent since OmniFocus generates the id server-side.
 * See #252.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/tools/project/update.ts — project_update (patch editable fields)
 * @see src/tools/task/create.ts — task_create (sibling idempotency slice)
 * @see docs/domain-reference.md — project schema
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CreateProjectInput, OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateProjectMutation } from "../../cache/invalidation.js";
import { FolderId, TagId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import {
  idempotencyStore as defaultIdempotencyStore,
  type IdempotencyStore,
  withIdempotencyKey,
} from "../../server/idempotencyStore.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PROJECT_CREATE_DESCRIPTION =
  "Create a new OmniFocus project. " +
  "Optionally place it in a folder, assign tags, set completion criterion, status, defer/due dates, " +
  "estimated minutes, flagged state, and review interval. " +
  "Safety control: pass idempotency_key to make transport retries safe — identical subsequent " +
  "calls within the TTL window replay the original envelope with meta.idempotentReplay = true " +
  "instead of creating a duplicate project. " +
  "Returns { created: true, id }. " +
  "Side effects: creates a project in OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need the project to appear on other devices.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const projectCreateInputSchema = z.object({
  name: z.string().min(1).describe("Project name. Required, must be non-empty."),
  folderId: FolderId.schema
    .optional()
    .describe("Folder ID to place the project in. Omit for root."),
  note: z.string().optional().describe("Plain-text note for the project."),
  status: z
    .enum(["active", "on-hold"])
    .optional()
    .describe("Initial project status. Default: active."),
  completionCriterion: z
    .enum(["parallel", "sequential", "singleActions"])
    .optional()
    .describe(
      "How the project's tasks are completed: parallel (any order), sequential (in order), or singleActions.",
    ),
  deferDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("Defer date as ISO-8601 with UTC offset."),
  dueDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("Due date as ISO-8601 with UTC offset."),
  estimatedMinutes: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Estimated total duration in minutes."),
  flagged: z.boolean().optional().describe("Flag the project."),
  tagIds: z.array(TagId.schema).optional().describe("Tag IDs to apply to the project."),
  reviewIntervalDays: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Review interval in days. Omit to use OmniFocus default."),

  // Safety-primitive control (#252 / #138)
  idempotency_key: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe(
      "Idempotency key for retry-safe creates. Identical subsequent calls within " +
        "the TTL window replay the original envelope with meta.idempotentReplay = true " +
        "instead of creating a duplicate project.",
    ),
});

export type ProjectCreateToolInput = z.infer<typeof projectCreateInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface ProjectCreateContext {
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
 * Pure handler for `project_create`.
 *
 * Wraps the create in `withIdempotencyKey` so retries under the same key
 * replay the original envelope instead of producing a duplicate project.
 *
 * @throws {NotFound} when folderId or any tagId does not exist
 * @throws {OmniFocusNotRunning} when OmniFocus is not running
 */
export async function handleProjectCreate(
  input: ProjectCreateToolInput,
  ctx: ProjectCreateContext,
) {
  const store = ctx.idempotencyStore ?? defaultIdempotencyStore;

  return withIdempotencyKey(store, input.idempotency_key, async () => {
    const projectInput: CreateProjectInput = {
      name: input.name,
      ...(input.folderId !== undefined && { folderId: input.folderId }),
      ...(input.note !== undefined && { note: input.note }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.completionCriterion !== undefined && {
        completionCriterion: input.completionCriterion,
      }),
      ...(input.deferDate !== undefined && { deferDate: input.deferDate }),
      ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
      ...(input.estimatedMinutes !== undefined && { estimatedMinutes: input.estimatedMinutes }),
      ...(input.flagged !== undefined && { flagged: input.flagged }),
      ...(input.tagIds !== undefined && { tagIds: input.tagIds }),
      ...(input.reviewIntervalDays !== undefined && {
        reviewIntervalDays: input.reviewIntervalDays,
      }),
    };

    const id = await ctx.adapter.createProject(projectInput);

    if (ctx.cache !== undefined) {
      invalidateProjectMutation(ctx.cache, { projectId: id });
    }

    return ok({ created: true as const, id }, ctx.makeMeta({ syncPending: true }));
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProjectCreateTool(server: McpServer, ctx: ProjectCreateContext) {
  return server.registerTool(
    "project_create",
    { description: PROJECT_CREATE_DESCRIPTION, inputSchema: projectCreateInputSchema.shape },
    async (args: ProjectCreateToolInput) => {
      const envelope = await handleProjectCreate(args, ctx);
      return toolResponse(envelope);
    },
  );
}
