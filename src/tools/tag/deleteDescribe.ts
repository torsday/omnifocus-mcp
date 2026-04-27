/**
 * `tag_delete_describe` — preview what tag_delete would do without mutating.
 *
 * @see src/tools/tag/delete.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ChangeRecord } from "../describe/types.js";
import { type TagDeleteToolInput, tagDeleteInputSchema } from "./delete.js";

export const TAG_DELETE_DESCRIBE_DESCRIPTION =
  "Preview what tag_delete would do without making any changes. " +
  "Do NOT use to actually delete a tag — use tag_delete instead. " +
  "Returns { description, plannedChanges } describing the permanent deletion that would occur. " +
  "No side effects: read-only by contract — never mutates OmniFocus.";

export interface TagDeleteDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleTagDeleteDescribe(
  input: TagDeleteToolInput,
  ctx: TagDeleteDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  let tagName: string = String(input.id);

  try {
    const tag = await ctx.adapter.getTag(input.id);
    tagName = tag.name;
  } catch {
    // fall back to ID
  }

  changes.push({ field: "deleted", newValue: "true" });

  const description = `Would permanently delete tag '${tagName}' (id: ${input.id}) and all its children. IRREVERSIBLE.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerTagDeleteDescribeTool(server: McpServer, ctx: TagDeleteDescribeContext) {
  return server.registerTool(
    "tag_delete_describe",
    { description: TAG_DELETE_DESCRIBE_DESCRIPTION, inputSchema: tagDeleteInputSchema.shape },
    async (args: TagDeleteToolInput) => {
      const envelope = await handleTagDeleteDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
