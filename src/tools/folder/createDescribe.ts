/**
 * `folder_create_describe` — preview what folder_create would do without mutating.
 *
 * @see src/tools/folder/create.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { resolveFolderName } from "../describe/prose.js";
import type { ChangeRecord } from "../describe/types.js";
import { type FolderCreateToolInput, folderCreateInputSchema } from "./create.js";

export const FOLDER_CREATE_DESCRIBE_DESCRIPTION =
  "Preview what folder_create would do without making any changes. " +
  "Do NOT use to actually create a folder — use folder_create instead. " +
  "Returns { description, plannedChanges } describing the folder that would be created. " +
  "No side effects: read-only by contract — never mutates OmniFocus. " +
  "Example: dry-run companion — pass the same args you would to the write tool, inspect plannedChanges, then call the write tool once approved.";

export interface FolderCreateDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleFolderCreateDescribe(
  input: FolderCreateToolInput,
  ctx: FolderCreateDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  const parts: string[] = [];

  changes.push({ field: "name", newValue: input.name });
  parts.push(`'${input.name}'`);

  if (input.parentId !== undefined) {
    const parentName = await resolveFolderName(ctx.adapter, input.parentId);
    changes.push({ field: "parentId", newValue: input.parentId });
    parts.push(`inside '${parentName}'`);
  } else {
    parts.push("at root");
  }

  const description = `Would create folder ${parts.join(", ")}.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerFolderCreateDescribeTool(
  server: McpServer,
  ctx: FolderCreateDescribeContext,
) {
  return server.registerTool(
    "folder_create_describe",
    {
      description: FOLDER_CREATE_DESCRIBE_DESCRIPTION,
      inputSchema: folderCreateInputSchema.shape,
    },
    async (args: FolderCreateToolInput) => {
      const envelope = await handleFolderCreateDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
