/**
 * `folder_create` MCP tool — create a new folder in OmniFocus.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/folderService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FolderId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";
import type { FolderService } from "../../services/folderService.js";

export const FOLDER_CREATE_DESCRIPTION =
  "Create a new folder in OmniFocus. " +
  "Optionally nest it inside an existing parent folder (get IDs from folder_list). " +
  "Returns the new folder's persistent ID. " +
  "Triggers a sync; call sync_trigger after to propagate to other devices.";

export const folderCreateInputSchema = z.object({
  name: z.string().min(1).describe("Folder name. Must be non-empty."),
  parentId: FolderId.schema
    .optional()
    .describe("Parent folder ID. Omit for a root-level folder. Get from folder_list."),
});

export type FolderCreateToolInput = z.infer<typeof folderCreateInputSchema>;

export interface FolderCreateContext {
  folderService: FolderService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleFolderCreate(input: FolderCreateToolInput, ctx: FolderCreateContext) {
  const createResult = await ctx.folderService.create({
    name: input.name,
    ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
  });
  const { folder } = await ctx.folderService.get(createResult.id);
  return ok({ folder }, ctx.makeMeta({ syncPending: true }));
}

export function registerFolderCreateTool(server: McpServer, ctx: FolderCreateContext) {
  return server.registerTool(
    "folder_create",
    { description: FOLDER_CREATE_DESCRIPTION, inputSchema: folderCreateInputSchema.shape },
    async (args: FolderCreateToolInput) => {
      const envelope = await handleFolderCreate(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
