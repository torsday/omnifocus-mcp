/**
 * `project_complete_describe` — preview what project_complete would do without mutating.
 *
 * @see src/tools/project/complete.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ChangeRecord } from "../describe/types.js";
import { type ProjectCompleteToolInput, projectCompleteInputSchema } from "./complete.js";

export const PROJECT_COMPLETE_DESCRIBE_DESCRIPTION =
  "Preview what project_complete would do without making any changes. " +
  "Do NOT use to actually complete a project — use project_complete instead. " +
  "Returns { description, plannedChanges } describing the completion that would occur. " +
  "No side effects: read-only by contract — never mutates OmniFocus. " +
  "Example: dry-run companion — pass the same args you would to the write tool, inspect plannedChanges, then call the write tool once approved.";

export interface ProjectCompleteDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleProjectCompleteDescribe(
  input: ProjectCompleteToolInput,
  ctx: ProjectCompleteDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  let projectName: string = String(input.id);

  try {
    const project = await ctx.adapter.getProject(input.id);
    projectName = project.name;
  } catch {
    // fall back to ID
  }

  changes.push({ field: "status", newValue: "done", oldValue: "active" });

  const description = `Would mark project '${projectName}' as completed.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerProjectCompleteDescribeTool(
  server: McpServer,
  ctx: ProjectCompleteDescribeContext,
) {
  return server.registerTool(
    "project_complete_describe",
    {
      description: PROJECT_COMPLETE_DESCRIBE_DESCRIPTION,
      inputSchema: projectCompleteInputSchema.shape,
    },
    async (args: ProjectCompleteToolInput) => {
      const envelope = await handleProjectCompleteDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
