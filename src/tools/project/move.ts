/**
 * `project_move` MCP tool — move an OmniFocus project to a different folder.
 *
 * @see src/tools/project/complete.ts — project_complete
 * @see src/tools/project/drop.ts — project_drop
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type InvalidatingCache, invalidateProjectMutation } from "../../cache/invalidation.js";
import { FolderId, ProjectId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ProjectService } from "../../services/projectService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PROJECT_MOVE_DESCRIPTION =
  "Move an OmniFocus project to a different folder. " +
  "Pass folderId to move into a folder, or null to move to the root (no folder). " +
  "Use when reorganizing projects. " +
  "Do not use to complete or drop a project. " +
  "Returns { moved: true, id }. " +
  "Side effects: changes the project's folder, sets meta.syncPending = true.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const projectMoveInputSchema = z.object({
  id: ProjectId.schema.describe("Persistent ID of the project to move."),
  folderId: FolderId.schema.nullable().describe("Target folder ID, or null to move to root."),
});

export type ProjectMoveToolInput = z.infer<typeof projectMoveInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface ProjectMoveContext {
  projectService: ProjectService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleProjectMove(input: ProjectMoveToolInput, ctx: ProjectMoveContext) {
  await ctx.projectService.moveProject(input.id, { folderId: input.folderId });
  if (ctx.cache !== undefined) {
    invalidateProjectMutation(ctx.cache, { projectId: input.id });
  }
  return ok({ moved: true as const, id: input.id }, ctx.makeMeta({ syncPending: true }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProjectMoveTool(server: McpServer, ctx: ProjectMoveContext) {
  return server.registerTool(
    "project_move",
    { description: PROJECT_MOVE_DESCRIPTION, inputSchema: projectMoveInputSchema.shape },
    async (args: ProjectMoveToolInput) => {
      const envelope = await handleProjectMove(args, ctx);
      return toolResponse(envelope);
    },
  );
}
