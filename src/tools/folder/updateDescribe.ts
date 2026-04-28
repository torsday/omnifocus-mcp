/**
 * `folder_update_describe` — preview what folder_update would do without mutating.
 *
 * @see src/tools/folder/update.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ChangeRecord } from "../describe/types.js";
import { type FolderUpdateToolInput, folderUpdateInputSchema } from "./update.js";

export const FOLDER_UPDATE_DESCRIBE_DESCRIPTION =
  "Preview what folder_update would do without making any changes. " +
  "Do NOT use to actually update a folder — use folder_update instead. " +
  "Returns { description, plannedChanges } showing the fields that would be patched. " +
  "No side effects: read-only by contract — never mutates OmniFocus. " +
  "Example: dry-run companion — pass the same args you would to the write tool, inspect plannedChanges, then call the write tool once approved.";

export interface FolderUpdateDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleFolderUpdateDescribe(
  input: FolderUpdateToolInput,
  ctx: FolderUpdateDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  const parts: string[] = [];
  let folderName: string = String(input.id);

  try {
    const folder = await ctx.adapter.getFolder(input.id);
    folderName = folder.name;

    if (input.name !== undefined) {
      changes.push({ field: "name", newValue: input.name, oldValue: folder.name });
      parts.push(`rename to '${input.name}'`);
    }
  } catch {
    if (input.name !== undefined) {
      changes.push({ field: "name", newValue: input.name });
      parts.push(`rename to '${input.name}'`);
    }
  }

  const description =
    parts.length > 0
      ? `Would update folder '${folderName}': ${parts.join(", ")}.`
      : `Would update folder '${folderName}' (no fields changed).`;

  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerFolderUpdateDescribeTool(
  server: McpServer,
  ctx: FolderUpdateDescribeContext,
) {
  return server.registerTool(
    "folder_update_describe",
    {
      description: FOLDER_UPDATE_DESCRIBE_DESCRIPTION,
      inputSchema: folderUpdateInputSchema.shape,
    },
    async (args: FolderUpdateToolInput) => {
      const envelope = await handleFolderUpdateDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
