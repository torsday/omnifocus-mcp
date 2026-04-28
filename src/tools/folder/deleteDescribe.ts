/**
 * `folder_delete_describe` — preview what folder_delete would do without mutating.
 *
 * @see src/tools/folder/delete.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ChangeRecord } from "../describe/types.js";
import { type FolderDeleteToolInput, folderDeleteInputSchema } from "./delete.js";

export const FOLDER_DELETE_DESCRIBE_DESCRIPTION =
  "Preview what folder_delete would do without making any changes. " +
  "Do NOT use to actually delete a folder — use folder_delete instead. " +
  "Returns { description, plannedChanges } describing the deletion that would occur. " +
  "No side effects: read-only by contract — never mutates OmniFocus. " +
  "Example: dry-run companion — pass the same args you would to the write tool, inspect plannedChanges, then call the write tool once approved.";

export interface FolderDeleteDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleFolderDeleteDescribe(
  input: FolderDeleteToolInput,
  ctx: FolderDeleteDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  let folderName: string = String(input.id);

  try {
    const folder = await ctx.adapter.getFolder(input.id);
    folderName = folder.name;
  } catch {
    // fall back to ID
  }

  changes.push({ field: "deleted", newValue: "true" });

  const cascadeNote =
    input.cascade === true ? " (cascade: orphan projects, delete subfolders)" : "";
  const description = `Would delete folder '${folderName}' (id: ${input.id})${cascadeNote}. IRREVERSIBLE.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerFolderDeleteDescribeTool(
  server: McpServer,
  ctx: FolderDeleteDescribeContext,
) {
  return server.registerTool(
    "folder_delete_describe",
    {
      description: FOLDER_DELETE_DESCRIBE_DESCRIPTION,
      inputSchema: folderDeleteInputSchema.shape,
    },
    async (args: FolderDeleteToolInput) => {
      const envelope = await handleFolderDeleteDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
