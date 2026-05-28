/**
 * `project_update_describe` — preview what project_update would do without mutating.
 *
 * @see src/tools/project/update.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { truncateCodePoints } from "../../domain/text.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { formatDate, resolveTagName } from "../describe/prose.js";
import type { ChangeRecord } from "../describe/types.js";
import { type ProjectUpdateToolInput, projectUpdateInputSchema } from "./update.js";

export const PROJECT_UPDATE_DESCRIBE_DESCRIPTION =
  "Preview what project_update would do without making any changes. " +
  "Do NOT use to actually update a project — use project_update instead. " +
  "Returns { description, plannedChanges } showing the fields that would be patched. " +
  "No side effects: read-only by contract — never mutates OmniFocus. " +
  "Example: dry-run companion — pass the same args you would to the write tool, inspect plannedChanges, then call the write tool once approved.";

export interface ProjectUpdateDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleProjectUpdateDescribe(
  input: ProjectUpdateToolInput,
  ctx: ProjectUpdateDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  const parts: string[] = [];
  let projectName: string = String(input.id);

  try {
    const project = await ctx.adapter.getProject(input.id);
    projectName = project.name;

    if (input.name !== undefined) {
      changes.push({ field: "name", newValue: input.name, oldValue: project.name });
      parts.push(`rename to '${input.name}'`);
    }
    if (input.status !== undefined) {
      changes.push({ field: "status", newValue: input.status, oldValue: project.status });
      parts.push(`set status to '${input.status}'`);
    }
    if (input.dueDate !== undefined) {
      changes.push({
        field: "dueDate",
        newValue: input.dueDate,
        oldValue: project.dueDate ?? null,
      });
      parts.push(
        input.dueDate === null ? "clear due date" : `set due date to ${formatDate(input.dueDate)}`,
      );
    }
    if (input.deferDate !== undefined) {
      changes.push({
        field: "deferDate",
        newValue: input.deferDate,
        oldValue: project.deferDate ?? null,
      });
      parts.push(
        input.deferDate === null
          ? "clear defer date"
          : `set defer date to ${formatDate(input.deferDate)}`,
      );
    }
    if (input.flagged !== undefined) {
      changes.push({
        field: "flagged",
        newValue: String(input.flagged),
        oldValue: String(project.flagged),
      });
      parts.push(input.flagged ? "flag" : "unflag");
    }
    if (input.tagIds !== undefined) {
      const tagNames = await Promise.all(input.tagIds.map((id) => resolveTagName(ctx.adapter, id)));
      changes.push({ field: "tagIds", newValue: input.tagIds.join(",") });
      parts.push(`set tags to [${tagNames.map((n) => `'${n}'`).join(", ")}]`);
    }
    if (input.note !== undefined) {
      changes.push({
        field: "note",
        newValue: input.note === null ? null : truncateCodePoints(input.note, 50),
      });
      parts.push(input.note === null ? "clear note" : "update note");
    }
  } catch {
    if (input.name !== undefined) {
      changes.push({ field: "name", newValue: input.name });
      parts.push(`rename to '${input.name}'`);
    }
  }

  const description =
    parts.length > 0
      ? `Would update project '${projectName}': ${parts.join(", ")}.`
      : `Would update project '${projectName}' (no fields changed).`;

  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerProjectUpdateDescribeTool(
  server: McpServer,
  ctx: ProjectUpdateDescribeContext,
) {
  return server.registerTool(
    "project_update_describe",
    {
      description: PROJECT_UPDATE_DESCRIBE_DESCRIPTION,
      inputSchema: projectUpdateInputSchema.shape,
    },
    async (args: ProjectUpdateToolInput) => {
      const envelope = await handleProjectUpdateDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
