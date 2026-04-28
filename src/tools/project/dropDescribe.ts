/**
 * `project_drop_describe` — preview what project_drop would do without mutating.
 *
 * @see src/tools/project/drop.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ChangeRecord } from "../describe/types.js";
import { type ProjectDropToolInput, projectDropInputSchema } from "./drop.js";

export const PROJECT_DROP_DESCRIBE_DESCRIPTION =
  "Preview what project_drop would do without making any changes. " +
  "Do NOT use to actually drop a project — use project_drop instead. " +
  "Returns { description, plannedChanges } describing the status change that would occur. " +
  "No side effects: read-only by contract — never mutates OmniFocus. " +
  "Example: dry-run companion — pass the same args you would to the write tool, inspect plannedChanges, then call the write tool once approved.";

export interface ProjectDropDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleProjectDropDescribe(
  input: ProjectDropToolInput,
  ctx: ProjectDropDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  let projectName: string = String(input.id);

  try {
    const project = await ctx.adapter.getProject(input.id);
    projectName = project.name;
  } catch {
    // fall back to ID
  }

  changes.push({ field: "status", newValue: "dropped", oldValue: "active" });

  const description = `Would drop project '${projectName}' (mark as on-hold/abandoned).`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerProjectDropDescribeTool(
  server: McpServer,
  ctx: ProjectDropDescribeContext,
) {
  return server.registerTool(
    "project_drop_describe",
    { description: PROJECT_DROP_DESCRIBE_DESCRIPTION, inputSchema: projectDropInputSchema.shape },
    async (args: ProjectDropToolInput) => {
      const envelope = await handleProjectDropDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
