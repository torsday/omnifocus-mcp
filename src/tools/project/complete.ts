/**
 * `project_complete` MCP tool — mark an OmniFocus project as done.
 *
 * @see src/tools/project/drop.ts — project_drop (status change without completing)
 * @see src/tools/project/delete.ts — project_delete (hard removal)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type InvalidatingCache, invalidateProjectMutation } from "../../cache/invalidation.js";
import { ProjectId } from "../../domain/ids.js";
import { type ResponseMeta, ok, toolResponse } from "../../envelope/index.js";
import type { ProjectService } from "../../services/projectService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PROJECT_COMPLETE_DESCRIPTION =
  "Complete an OmniFocus project — marks it done with today's date and moves it out of the active view. " +
  "Use when a project is finished. " +
  "Do not use to archive or hide a project without completing it; prefer project_drop for that. " +
  "Returns { completed: true, id }. " +
  "Side effects: sets completionDate, removes from active projects, sets meta.syncPending = true.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const projectCompleteInputSchema = z.object({
  id: ProjectId.schema.describe("Persistent ID of the project to complete."),
});

export type ProjectCompleteToolInput = z.infer<typeof projectCompleteInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface ProjectCompleteContext {
  projectService: ProjectService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleProjectComplete(
  input: ProjectCompleteToolInput,
  ctx: ProjectCompleteContext,
) {
  await ctx.projectService.completeProject(input.id);
  if (ctx.cache !== undefined) {
    invalidateProjectMutation(ctx.cache, { projectId: input.id });
  }
  return ok({ completed: true as const, id: input.id }, ctx.makeMeta({ syncPending: true }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProjectCompleteTool(server: McpServer, ctx: ProjectCompleteContext) {
  return server.registerTool(
    "project_complete",
    { description: PROJECT_COMPLETE_DESCRIPTION, inputSchema: projectCompleteInputSchema.shape },
    async (args: ProjectCompleteToolInput) => {
      const envelope = await handleProjectComplete(args, ctx);
      return toolResponse(envelope);
    },
  );
}
