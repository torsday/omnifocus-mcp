/**
 * `project_drop` MCP tool — mark an OmniFocus project as dropped (on-hold/abandoned).
 *
 * @see src/tools/project/complete.ts — project_complete (marks project done)
 * @see src/tools/project/delete.ts — project_delete (hard removal)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type InvalidatingCache, invalidateProjectMutation } from "../../cache/invalidation.js";
import { ProjectId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";
import type { ProjectService } from "../../services/projectService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PROJECT_DROP_DESCRIPTION =
  "Drop an OmniFocus project — marks it as on-hold/dropped and removes it from the active view without completing it. " +
  "Use to defer or abandon a project while keeping it recoverable. " +
  "Do not use if the project is actually done; prefer project_complete for that. " +
  "Returns { dropped: true, id }. " +
  "Side effects: changes project status, sets meta.syncPending = true.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const projectDropInputSchema = z.object({
  id: ProjectId.schema.describe("Persistent ID of the project to drop."),
});

export type ProjectDropToolInput = z.infer<typeof projectDropInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface ProjectDropContext {
  projectService: ProjectService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleProjectDrop(input: ProjectDropToolInput, ctx: ProjectDropContext) {
  await ctx.projectService.dropProject(input.id);
  if (ctx.cache !== undefined) {
    invalidateProjectMutation(ctx.cache, { projectId: input.id });
  }
  return ok({ dropped: true as const, id: input.id }, ctx.makeMeta({ syncPending: true }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProjectDropTool(server: McpServer, ctx: ProjectDropContext) {
  return server.registerTool(
    "project_drop",
    { description: PROJECT_DROP_DESCRIPTION, inputSchema: projectDropInputSchema.shape },
    async (args: ProjectDropToolInput) => {
      const envelope = await handleProjectDrop(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
