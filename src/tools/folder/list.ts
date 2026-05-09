/**
 * `folder_list` MCP tool — list folders in OmniFocus.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/folderService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FolderId } from "../../domain/ids.js";
import { FOLDER_DEFAULTS } from "../../envelope/defaultsRegistry.js";
import { elideDefaultsAll } from "../../envelope/elideDefaults.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { FolderListInput, FolderService } from "../../services/folderService.js";

export const FOLDER_LIST_DESCRIPTION =
  "List folders in OmniFocus, optionally filtered by parent folder. " +
  "Do not use to fetch a single folder by ID; prefer folder_get instead. " +
  "Returns a flat array with projectCount and subfolderCount per folder. " +
  "Use parentId to walk the hierarchy one level at a time. " +
  "Safe to call repeatedly; no side effects. " +
  "Example: folder_list({}) " +
  'Example: folder_list({ parentId: "fld123" })';

export const folderListInputSchema = z.object({
  parentId: FolderId.schema
    .optional()
    .describe(
      "Return only direct children of this folder. Get the ID from a previous folder_list call. Omit for root folders.",
    ),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "When true, return the full unelided folder shape. " +
        "Default: false — `parentId` is omitted when null (top-level folder). " +
        "See docs/token-cost.md for the defaults table.",
    ),
});

export type FolderListToolInput = z.infer<typeof folderListInputSchema>;

export interface FolderListContext {
  folderService: FolderService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleFolderList(input: FolderListToolInput, ctx: FolderListContext) {
  const serviceInput: FolderListInput = {
    ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
  };
  const result = await ctx.folderService.list(serviceInput);
  const folders =
    input.verbose === true ? result.folders : elideDefaultsAll(result.folders, FOLDER_DEFAULTS);
  return ok({ folders }, ctx.makeMeta({ cacheHit: result.cacheHit }));
}

export function registerFolderListTool(server: McpServer, ctx: FolderListContext) {
  return server.registerTool(
    "folder_list",
    { description: FOLDER_LIST_DESCRIPTION, inputSchema: folderListInputSchema.shape },
    async (args: FolderListToolInput) => {
      const envelope = await handleFolderList(args, ctx);
      return toolResponse(envelope);
    },
  );
}
