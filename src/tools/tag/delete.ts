/**
 * `tag_delete` MCP tool — hard-delete a tag from OmniFocus. Irreversible.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/tagService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TagId } from "../../domain/ids.js";
import { summaryTagDeleteById } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { TagService } from "../../services/tagService.js";

export const TAG_DELETE_DESCRIPTION =
  "Hard-delete a tag from OmniFocus. IRREVERSIBLE — the tag and all its children are removed. " +
  "Tasks that carried this tag lose it. " +
  "Get the tag ID from tag_list. " +
  "Prefer tag_set_status with status='dropped' to preserve history. " +
  "Returns the deleted tag's ID on success. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  'Example: tag_delete({ id: "tag123" })';

export const tagDeleteInputSchema = z.object({
  id: TagId.schema.describe("Persistent tag ID to delete. Get from tag_list."),
});

export type TagDeleteToolInput = z.infer<typeof tagDeleteInputSchema>;

export interface TagDeleteContext {
  tagService: TagService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `tag_delete`.
 */
export async function handleTagDelete(input: TagDeleteToolInput, ctx: TagDeleteContext) {
  await ctx.tagService.delete(input.id);
  return ok(
    { deleted: true, id: input.id },
    ctx.makeMeta({ syncPending: true, humanReadableSummary: summaryTagDeleteById() }),
  );
}

export function registerTagDeleteTool(server: McpServer, ctx: TagDeleteContext) {
  return server.registerTool(
    "tag_delete",
    { description: TAG_DELETE_DESCRIPTION, inputSchema: tagDeleteInputSchema.shape },
    async (args: TagDeleteToolInput) => {
      const envelope = await handleTagDelete(args, ctx);
      return toolResponse(envelope);
    },
  );
}
