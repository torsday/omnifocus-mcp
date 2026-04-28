/**
 * `project_move_describe` — preview what project_move would do without mutating.
 *
 * @see src/tools/project/move.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { resolveFolderName } from "../describe/prose.js";
import type { ChangeRecord } from "../describe/types.js";
import { type ProjectMoveToolInput, projectMoveInputSchema } from "./move.js";

export const PROJECT_MOVE_DESCRIBE_DESCRIPTION =
  "Preview what project_move would do without making any changes. " +
  "Do NOT use to actually move a project — use project_move instead. " +
  "Returns { description, plannedChanges } describing the folder change that would occur. " +
  "No side effects: read-only by contract — never mutates OmniFocus. " +
  "Example: dry-run companion — pass the same args you would to the write tool, inspect plannedChanges, then call the write tool once approved.";

export interface ProjectMoveDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleProjectMoveDescribe(
  input: ProjectMoveToolInput,
  ctx: ProjectMoveDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  let projectName: string = String(input.id);

  try {
    const project = await ctx.adapter.getProject(input.id);
    projectName = project.name;
  } catch {
    // fall back to ID
  }

  let destDescription: string;
  if (input.folderId !== null) {
    const folderName = await resolveFolderName(ctx.adapter, input.folderId);
    changes.push({ field: "folderId", newValue: input.folderId });
    destDescription = `folder '${folderName}'`;
  } else {
    changes.push({ field: "folderId", newValue: null });
    destDescription = "root (no folder)";
  }

  const description = `Would move project '${projectName}' to ${destDescription}.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerProjectMoveDescribeTool(
  server: McpServer,
  ctx: ProjectMoveDescribeContext,
) {
  return server.registerTool(
    "project_move_describe",
    {
      description: PROJECT_MOVE_DESCRIBE_DESCRIPTION,
      inputSchema: projectMoveInputSchema.shape,
    },
    async (args: ProjectMoveToolInput) => {
      const envelope = await handleProjectMoveDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
