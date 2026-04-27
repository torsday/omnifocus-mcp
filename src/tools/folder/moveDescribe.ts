/**
 * `folder_move_describe` — preview what folder_move would do without mutating.
 *
 * @see src/tools/folder/move.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { resolveFolderName } from "../describe/prose.js";
import type { ChangeRecord } from "../describe/types.js";
import { type FolderMoveToolInput, folderMoveInputSchema } from "./move.js";

export const FOLDER_MOVE_DESCRIBE_DESCRIPTION =
  "Preview what folder_move would do without making any changes. " +
  "Do NOT use to actually move a folder — use folder_move instead. " +
  "Returns { description, plannedChanges } describing the reparenting that would occur. " +
  "No side effects: read-only by contract — never mutates OmniFocus.";

export interface FolderMoveDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleFolderMoveDescribe(
  input: FolderMoveToolInput,
  ctx: FolderMoveDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  let folderName: string = String(input.id);

  try {
    const folder = await ctx.adapter.getFolder(input.id);
    folderName = folder.name;
  } catch {
    // fall back to ID
  }

  let destDescription: string;
  if (input.parentId !== null) {
    const parentName = await resolveFolderName(ctx.adapter, input.parentId);
    changes.push({ field: "parentId", newValue: input.parentId });
    destDescription = `inside '${parentName}'`;
  } else {
    changes.push({ field: "parentId", newValue: null });
    destDescription = "root level";
  }

  const description = `Would move folder '${folderName}' to ${destDescription}.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerFolderMoveDescribeTool(server: McpServer, ctx: FolderMoveDescribeContext) {
  return server.registerTool(
    "folder_move_describe",
    { description: FOLDER_MOVE_DESCRIBE_DESCRIPTION, inputSchema: folderMoveInputSchema.shape },
    async (args: FolderMoveToolInput) => {
      const envelope = await handleFolderMoveDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
