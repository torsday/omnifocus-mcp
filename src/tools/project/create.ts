/**
 * `project_create` MCP tool — create a new OmniFocus project.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/tools/project/update.ts — project_update (patch editable fields)
 * @see docs/domain-reference.md — project schema
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CreateProjectInput, OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateProjectMutation } from "../../cache/invalidation.js";
import { FolderId, TagId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PROJECT_CREATE_DESCRIPTION =
  "Create a new OmniFocus project. " +
  "Optionally place it in a folder, assign tags, set completion criterion, status, defer/due dates, " +
  "estimated minutes, flagged state, and review interval. " +
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
});

export type ProjectCreateToolInput = z.infer<typeof projectCreateInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface ProjectCreateContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

/**
 * Pure handler for `project_create`.
 *
 * Delegates to `adapter.createProject`, then flushes the project-mutation
 * cache scopes. Returns the new project's ID.
 *
 * @throws {NotFound} when folderId or any tagId does not exist
 * @throws {OmniFocusNotRunning} when OmniFocus is not running
 */
export async function handleProjectCreate(
  input: ProjectCreateToolInput,
  ctx: ProjectCreateContext,
) {
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
    ...(input.reviewIntervalDays !== undefined && { reviewIntervalDays: input.reviewIntervalDays }),
  };

  const id = await ctx.adapter.createProject(projectInput);

  if (ctx.cache !== undefined) {
    invalidateProjectMutation(ctx.cache, { projectId: id });
  }

  return ok({ created: true as const, id }, ctx.makeMeta({ syncPending: true }));
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
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
