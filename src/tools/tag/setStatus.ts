/**
 * `tag_set_status` MCP tool — set the lifecycle status of a tag.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/tagService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { aliasedEnum } from "../../domain/aliasedEnum.js";
import { TagId } from "../../domain/ids.js";
import { summaryTagUpdate } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { TagService } from "../../services/tagService.js";

export const TAG_SET_STATUS_DESCRIPTION =
  "Set the lifecycle status of a tag to active, on-hold, or dropped. " +
  "Dropped tags are hidden in OmniFocus but not deleted. " +
  "Do not use to permanently remove a tag; prefer tag_delete instead. " +
  "Get the tag ID from tag_list. " +
  "Returns the updated tag with the confirmed status. " +
  "Triggers a sync; call sync_trigger after to propagate to other devices. " +
  'Example: tag_set_status({ id: "tag123", status: "on-hold" }) ' +
  'Example: tag_set_status({ id: "tag123", status: "active" })';

export const tagSetStatusInputSchema = z.object({
  id: TagId.schema.describe("Persistent tag ID. Get from tag_list."),
  status: aliasedEnum(
    ["active", "on-hold", "dropped"] as const,
    { paused: "on-hold", cancelled: "dropped", archived: "dropped" },
    "New lifecycle status for the tag.",
  ),
});

export type TagSetStatusToolInput = z.infer<typeof tagSetStatusInputSchema>;

export interface TagSetStatusContext {
  tagService: TagService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `tag_set_status`.
 */
export async function handleTagSetStatus(input: TagSetStatusToolInput, ctx: TagSetStatusContext) {
  await ctx.tagService.setStatus(input.id, input.status);
  const { tag } = await ctx.tagService.get(input.id);
  return ok(
    { tag },
    ctx.makeMeta({ syncPending: true, humanReadableSummary: summaryTagUpdate(tag.name) }),
  );
}

export function registerTagSetStatusTool(server: McpServer, ctx: TagSetStatusContext) {
  return server.registerTool(
    "tag_set_status",
    { description: TAG_SET_STATUS_DESCRIPTION, inputSchema: tagSetStatusInputSchema.shape },
    async (args: TagSetStatusToolInput) => {
      const envelope = await handleTagSetStatus(args, ctx);
      return toolResponse(envelope);
    },
  );
}
