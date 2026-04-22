/**
 * `tag_move` MCP tool — move a tag to a new parent (or promote to root).
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/tagService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TagId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";
import type { TagService } from "../../services/tagService.js";

export const TAG_MOVE_DESCRIPTION =
  "Move a tag to a new parent, or promote it to a root tag by passing parentId=null. " +
  "Get tag IDs from tag_list. " +
  "Triggers a sync; call sync_trigger after to propagate to other devices.";

export const tagMoveInputSchema = z.object({
  id: TagId.schema.describe("Persistent ID of the tag to move. Get from tag_list."),
  parentId: TagId.schema
    .nullable()
    .describe("New parent tag ID, or null to promote the tag to root level."),
});

export type TagMoveToolInput = z.infer<typeof tagMoveInputSchema>;

export interface TagMoveContext {
  tagService: TagService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `tag_move`.
 */
export async function handleTagMove(input: TagMoveToolInput, ctx: TagMoveContext) {
  await ctx.tagService.move(input.id, input.parentId);
  return ok({}, ctx.makeMeta());
}

export function registerTagMoveTool(server: McpServer, ctx: TagMoveContext) {
  return server.registerTool(
    "tag_move",
    { description: TAG_MOVE_DESCRIPTION, inputSchema: tagMoveInputSchema.shape },
    async (args: TagMoveToolInput) => {
      const envelope = await handleTagMove(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
