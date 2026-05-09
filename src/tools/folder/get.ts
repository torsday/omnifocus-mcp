/**
 * `folder_get` MCP tool — fetch a single folder by its persistent ID.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/folderService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FolderId } from "../../domain/ids.js";
import { FOLDER_DEFAULTS } from "../../envelope/defaultsRegistry.js";
import { elideDefaults } from "../../envelope/elideDefaults.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { FolderService } from "../../services/folderService.js";

export const FOLDER_GET_DESCRIPTION =
  "Fetch a single folder by its persistent ID, including project and subfolder counts. " +
  "Do not use to list multiple folders; prefer folder_list instead. " +
  "Returns folder details including name, parentId, projectCount, and subfolderCount. " +
  "Safe to call repeatedly; no side effects. " +
  'Example: folder_get({ id: "fld123" })';

export const folderGetInputSchema = z.object({
  id: FolderId.schema.describe(
    "Persistent folder ID. Get from folder_list. IDs are stable across renames.",
  ),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "When true, return the full unelided folder shape. " +
        "Default: false — `parentId` is omitted when null. " +
        "See docs/token-cost.md for the defaults table.",
    ),
});

export type FolderGetToolInput = z.infer<typeof folderGetInputSchema>;

export interface FolderGetContext {
  folderService: FolderService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleFolderGet(input: FolderGetToolInput, ctx: FolderGetContext) {
  const result = await ctx.folderService.get(input.id);
  const folder =
    input.verbose === true ? result.folder : elideDefaults(result.folder, FOLDER_DEFAULTS);
  return ok({ folder }, ctx.makeMeta({ cacheHit: result.cacheHit }));
}

export function registerFolderGetTool(server: McpServer, ctx: FolderGetContext) {
  return server.registerTool(
    "folder_get",
    { description: FOLDER_GET_DESCRIPTION, inputSchema: folderGetInputSchema.shape },
    async (args: FolderGetToolInput) => {
      const envelope = await handleFolderGet(args, ctx);
      return toolResponse(envelope);
    },
  );
}
