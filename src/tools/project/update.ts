/**
 * `project_update` MCP tool — partial-patch update for OmniFocus projects.
 *
 * Only supplied fields are changed; omit a field to leave it unchanged.
 * Pass null for nullable fields (note, deferDate, dueDate, estimatedMinutes,
 * reviewIntervalDays) to clear them.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/tools/project/create.ts — project_create (initial creation)
 * @see docs/domain-reference.md — project schema
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter, UpdateProjectInput } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateProjectMutation } from "../../cache/invalidation.js";
import { ProjectId, TagId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PROJECT_UPDATE_DESCRIPTION =
  "Partially update mutable fields on an OmniFocus project. " +
  "Only supplied fields are changed; omit a field to leave it unchanged. " +
  "Pass null for note, deferDate, dueDate, estimatedMinutes, or reviewIntervalDays to clear those fields. " +
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
}

/**
 * Pure handler for `project_update`.
 *
 * Delegates to `adapter.updateProject` with only the supplied patch fields.
 * Flushes the project-mutation cache scopes on success.
 *
 * @throws {NotFound} when the project ID or any tag ID does not exist
 * @throws {OmniFocusNotRunning} when OmniFocus is not running
 */
export async function handleProjectUpdate(
  input: ProjectUpdateToolInput,
  ctx: ProjectUpdateContext,
) {
  const { id, ...rest } = input;

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
    ...(rest.reviewIntervalDays !== undefined && { reviewIntervalDays: rest.reviewIntervalDays }),
  };

  await ctx.adapter.updateProject(id, patch);

  if (ctx.cache !== undefined) {
    invalidateProjectMutation(ctx.cache, { projectId: id });
  }

  return ok({ updated: true as const, id }, ctx.makeMeta({ syncPending: true }));
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
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
