/**
 * `folder_delete` MCP tool — delete a folder from OmniFocus.
 *
 * Requires `cascade: true` to delete non-empty folders. Without it the tool
 * returns a ValidationError describing the contents, giving the agent a chance
 * to handle them explicitly before retrying.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/folderService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FolderId } from "../../domain/ids.js";
import { type ResponseMeta, ok, toolResponse } from "../../envelope/index.js";
import type { FolderService } from "../../services/folderService.js";

export const FOLDER_DELETE_DESCRIPTION =
  "Delete a folder from OmniFocus. " +
  "By default returns ValidationError when the folder contains projects or subfolders. " +
  "Pass cascade=true to orphan all direct projects (move to no folder) and recursively delete subfolders before deleting. " +
  "IRREVERSIBLE — do not use to archive; prefer folder_update to rename instead. " +
  "Get the folder ID from folder_list. " +
  "Triggers a sync; call sync_trigger after to propagate to other devices.";

export const folderDeleteInputSchema = z.object({
  id: FolderId.schema.describe("Persistent folder ID to delete. Get from folder_list."),
  cascade: z
    .boolean()
    .optional()
    .describe(
      "When true, orphan all direct projects and recursively delete subfolders before deleting. Default false — returns an error if the folder is non-empty.",
    ),
});

export type FolderDeleteToolInput = z.infer<typeof folderDeleteInputSchema>;

export interface FolderDeleteContext {
  folderService: FolderService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleFolderDelete(input: FolderDeleteToolInput, ctx: FolderDeleteContext) {
  await ctx.folderService.delete(input.id, input.cascade ?? false);
  return ok({ deleted: true, id: input.id }, ctx.makeMeta({ syncPending: true }));
}

export function registerFolderDeleteTool(server: McpServer, ctx: FolderDeleteContext) {
  return server.registerTool(
    "folder_delete",
    { description: FOLDER_DELETE_DESCRIPTION, inputSchema: folderDeleteInputSchema.shape },
    async (args: FolderDeleteToolInput) => {
      const envelope = await handleFolderDelete(args, ctx);
      return toolResponse(envelope);
    },
  );
}
