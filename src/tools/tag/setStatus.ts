/**
 * `tag_set_status` MCP tool — set the lifecycle status of a tag.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/tagService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TagId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";
import type { TagService } from "../../services/tagService.js";

export const TAG_SET_STATUS_DESCRIPTION =
  "Set the lifecycle status of a tag to active, on-hold, or dropped. " +
  "Dropped tags are hidden in OmniFocus but not deleted. " +
  "Get the tag ID from tag_list. " +
  "Triggers a sync; call sync_trigger after to propagate to other devices.";

export const tagSetStatusInputSchema = z.object({
  id: TagId.schema.describe("Persistent tag ID. Get from tag_list."),
  status: z.enum(["active", "on-hold", "dropped"]).describe("New lifecycle status for the tag."),
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
  return ok({ tag }, ctx.makeMeta({ syncPending: true }));
}

export function registerTagSetStatusTool(server: McpServer, ctx: TagSetStatusContext) {
  return server.registerTool(
    "tag_set_status",
    { description: TAG_SET_STATUS_DESCRIPTION, inputSchema: tagSetStatusInputSchema.shape },
    async (args: TagSetStatusToolInput) => {
      const envelope = await handleTagSetStatus(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
