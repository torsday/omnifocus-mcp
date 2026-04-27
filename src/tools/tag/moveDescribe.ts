/**
 * `tag_move_describe` — preview what tag_move would do without mutating.
 *
 * @see src/tools/tag/move.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { resolveTagName } from "../describe/prose.js";
import type { ChangeRecord } from "../describe/types.js";
import { type TagMoveToolInput, tagMoveInputSchema } from "./move.js";

export const TAG_MOVE_DESCRIBE_DESCRIPTION =
  "Preview what tag_move would do without making any changes. " +
  "Do NOT use to actually move a tag — use tag_move instead. " +
  "Returns { description, plannedChanges } describing the reparenting that would occur. " +
  "No side effects: read-only by contract — never mutates OmniFocus.";

export interface TagMoveDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleTagMoveDescribe(input: TagMoveToolInput, ctx: TagMoveDescribeContext) {
  const changes: ChangeRecord[] = [];
  let tagName: string = String(input.id);

  try {
    const tag = await ctx.adapter.getTag(input.id);
    tagName = tag.name;
  } catch {
    // fall back to ID
  }

  let destDescription: string;
  if (input.parentId !== null) {
    const parentName = await resolveTagName(ctx.adapter, input.parentId);
    changes.push({ field: "parentId", newValue: input.parentId });
    destDescription = `under '${parentName}'`;
  } else {
    changes.push({ field: "parentId", newValue: null });
    destDescription = "root level";
  }

  const description = `Would move tag '${tagName}' to ${destDescription}.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerTagMoveDescribeTool(server: McpServer, ctx: TagMoveDescribeContext) {
  return server.registerTool(
    "tag_move_describe",
    { description: TAG_MOVE_DESCRIBE_DESCRIPTION, inputSchema: tagMoveInputSchema.shape },
    async (args: TagMoveToolInput) => {
      const envelope = await handleTagMoveDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
