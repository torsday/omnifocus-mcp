/**
 * `project_create_describe` — preview what project_create would do without mutating.
 *
 * @see src/tools/project/create.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { formatDate, resolveFolderName, resolveTagName } from "../describe/prose.js";
import type { ChangeRecord } from "../describe/types.js";
import { type ProjectCreateToolInput, projectCreateInputSchema } from "./create.js";

export const PROJECT_CREATE_DESCRIBE_DESCRIPTION =
  "Preview what project_create would do without making any changes. " +
  "Do NOT use to actually create a project — use project_create instead. " +
  "Returns { description, plannedChanges } describing the project that would be created. " +
  "No side effects: read-only by contract — never mutates OmniFocus.";

export interface ProjectCreateDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleProjectCreateDescribe(
  input: ProjectCreateToolInput,
  ctx: ProjectCreateDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  const parts: string[] = [];

  changes.push({ field: "name", newValue: input.name });
  parts.push(`'${input.name}'`);

  if (input.folderId !== undefined) {
    const folderName = await resolveFolderName(ctx.adapter, input.folderId);
    changes.push({ field: "folderId", newValue: input.folderId });
    parts.push(`in folder '${folderName}'`);
  } else {
    parts.push("at root");
  }

  if (input.status !== undefined) {
    changes.push({ field: "status", newValue: input.status });
    parts.push(`status '${input.status}'`);
  }
  if (input.dueDate !== undefined) {
    changes.push({ field: "dueDate", newValue: input.dueDate });
    parts.push(`due ${formatDate(input.dueDate)}`);
  }
  if (input.deferDate !== undefined) {
    changes.push({ field: "deferDate", newValue: input.deferDate });
    parts.push(`deferred until ${formatDate(input.deferDate)}`);
  }
  if (input.flagged === true) {
    changes.push({ field: "flagged", newValue: "true" });
    parts.push("flagged");
  }
  if (input.tagIds !== undefined && input.tagIds.length > 0) {
    const tagNames = await Promise.all(input.tagIds.map((id) => resolveTagName(ctx.adapter, id)));
    changes.push({ field: "tagIds", newValue: input.tagIds.join(",") });
    parts.push(`tagged ${tagNames.map((n) => `'${n}'`).join(", ")}`);
  }
  if (input.note !== undefined) {
    changes.push({ field: "note", newValue: input.note.slice(0, 50) });
  }

  const description = `Would create project ${parts.join(", ")}.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerProjectCreateDescribeTool(
  server: McpServer,
  ctx: ProjectCreateDescribeContext,
) {
  return server.registerTool(
    "project_create_describe",
    {
      description: PROJECT_CREATE_DESCRIBE_DESCRIPTION,
      inputSchema: projectCreateInputSchema.shape,
    },
    async (args: ProjectCreateToolInput) => {
      const envelope = await handleProjectCreateDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
