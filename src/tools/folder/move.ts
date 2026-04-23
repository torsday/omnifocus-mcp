/**
 * `folder_move` MCP tool — move a folder to a new parent (or promote to root).
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/folderService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FolderId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";
import type { FolderService } from "../../services/folderService.js";

export const FOLDER_MOVE_DESCRIPTION =
  "Move a folder to a new parent, or promote it to a root folder by passing parentId=null. " +
  "Get folder IDs from folder_list. " +
  "Triggers a sync; call sync_trigger after to propagate to other devices.";

export const folderMoveInputSchema = z.object({
  id: FolderId.schema.describe("Persistent ID of the folder to move. Get from folder_list."),
  parentId: FolderId.schema
    .nullable()
    .describe("New parent folder ID, or null to promote the folder to root level."),
});

export type FolderMoveToolInput = z.infer<typeof folderMoveInputSchema>;

export interface FolderMoveContext {
  folderService: FolderService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleFolderMove(input: FolderMoveToolInput, ctx: FolderMoveContext) {
  await ctx.folderService.move(input.id, input.parentId);
  const { folder } = await ctx.folderService.get(input.id);
  return ok({ folder }, ctx.makeMeta());
}

export function registerFolderMoveTool(server: McpServer, ctx: FolderMoveContext) {
  return server.registerTool(
    "folder_move",
    { description: FOLDER_MOVE_DESCRIPTION, inputSchema: folderMoveInputSchema.shape },
    async (args: FolderMoveToolInput) => {
      const envelope = await handleFolderMove(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
