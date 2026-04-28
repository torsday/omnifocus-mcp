/**
 * `project_delete_describe` — preview what project_delete would do without mutating.
 *
 * @see src/tools/project/delete.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ChangeRecord } from "../describe/types.js";
import { type ProjectDeleteToolInput, projectDeleteInputSchema } from "./delete.js";

export const PROJECT_DELETE_DESCRIBE_DESCRIPTION =
  "Preview what project_delete would do without making any changes. " +
  "Do NOT use to actually delete a project — use project_delete instead. " +
  "Returns { description, plannedChanges } describing the permanent deletion that would occur. " +
  "No side effects: read-only by contract — never mutates OmniFocus. " +
  "Example: dry-run companion — pass the same args you would to the write tool, inspect plannedChanges, then call the write tool once approved.";

export interface ProjectDeleteDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleProjectDeleteDescribe(
  input: ProjectDeleteToolInput,
  ctx: ProjectDeleteDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  let projectName: string = String(input.id);

  try {
    const project = await ctx.adapter.getProject(input.id);
    projectName = project.name;
  } catch {
    // fall back to ID
  }

  changes.push({ field: "deleted", newValue: "true" });

  const description = `Would permanently delete project '${projectName}' (id: ${input.id}) and ALL its contained tasks. IRREVERSIBLE.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerProjectDeleteDescribeTool(
  server: McpServer,
  ctx: ProjectDeleteDescribeContext,
) {
  return server.registerTool(
    "project_delete_describe",
    {
      description: PROJECT_DELETE_DESCRIBE_DESCRIPTION,
      inputSchema: projectDeleteInputSchema.shape,
    },
    async (args: ProjectDeleteToolInput) => {
      const envelope = await handleProjectDeleteDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
