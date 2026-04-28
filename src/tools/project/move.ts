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
import { summaryProjectMoveById } from "../../domain/writeSummary.js";
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
  "Returns { moved: true, id, name } — name lets the agent describe the change without a follow-up read. " +
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
  // Pre-mutation fetch lets us pair the name into the response — see
  // project/complete.ts for the rationale.
  const { project } = await ctx.projectService.get({ id: input.id, includeTaskTree: false });
  await ctx.projectService.moveProject(input.id, { folderId: input.folderId });
  if (ctx.cache !== undefined) {
    invalidateProjectMutation(ctx.cache, { projectId: input.id });
  }
  return ok(
    { moved: true as const, id: input.id, name: project.name },
    ctx.makeMeta({
      syncPending: true,
      humanReadableSummary: summaryProjectMoveById(
        input.folderId != null ? "folder" : "library root",
      ),
    }),
  );
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
