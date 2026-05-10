/**
 * `folder_update` MCP tool — rename a folder (partial patch).
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/folderService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FolderId } from "../../domain/ids.js";
import { NAME_MAX_CHARS } from "../../domain/inputLimits.js";
import { summaryFolderUpdate } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { FolderService } from "../../services/folderService.js";

export const FOLDER_UPDATE_DESCRIPTION =
  "Rename a folder (partial patch — only supplied fields are changed). " +
  "To move a folder use folder_move instead. " +
  "Get the folder ID from folder_list. " +
  "Returns the updated folder on success. " +
  "Triggers a sync; call sync_trigger after to propagate to other devices. " +
  'Example: folder_update({ id: "fld123", name: "Personal" })';

export const folderUpdateInputSchema = z.object({
  id: FolderId.schema.describe("Persistent folder ID. Get from folder_list."),
  name: z
    .string()
    .min(1)
    .max(NAME_MAX_CHARS, "max 1 KB")
    .optional()
    .describe("New folder name. Must be non-empty if supplied."),
});

export type FolderUpdateToolInput = z.infer<typeof folderUpdateInputSchema>;

export interface FolderUpdateContext {
  folderService: FolderService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleFolderUpdate(input: FolderUpdateToolInput, ctx: FolderUpdateContext) {
  const { id, ...patch } = input;
  await ctx.folderService.update(id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
  });
  const { folder } = await ctx.folderService.get(id);
  return ok(
    { folder },
    ctx.makeMeta({ syncPending: true, humanReadableSummary: summaryFolderUpdate(folder.name) }),
  );
}

export function registerFolderUpdateTool(server: McpServer, ctx: FolderUpdateContext) {
  return server.registerTool(
    "folder_update",
    { description: FOLDER_UPDATE_DESCRIPTION, inputSchema: folderUpdateInputSchema.shape },
    async (args: FolderUpdateToolInput) => {
      const envelope = await handleFolderUpdate(args, ctx);
      return toolResponse(envelope);
    },
  );
}
