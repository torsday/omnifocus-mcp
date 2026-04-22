/**
 * `tag_update` MCP tool — update mutable fields on an existing tag (partial patch).
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/tagService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TagId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";
import type { TagService } from "../../services/tagService.js";

export const TAG_UPDATE_DESCRIPTION =
  "Update mutable fields on an existing tag (partial patch). " +
  "Only supplied fields are changed; omit a field to leave it unchanged. " +
  "Get the tag ID from tag_list. " +
  "Triggers a sync; call sync_trigger after to propagate to other devices.";

export const tagUpdateInputSchema = z.object({
  id: TagId.schema.describe("Persistent tag ID. Get from tag_list."),
  name: z.string().min(1).optional().describe("New tag name. Must be non-empty if supplied."),
  parentId: TagId.schema
    .nullable()
    .optional()
    .describe("New parent tag ID. Pass null to promote to root. Get from tag_list."),
  status: z.enum(["active", "on-hold", "dropped"]).optional().describe("New lifecycle status."),
  allowsNextAction: z
    .boolean()
    .optional()
    .describe("Whether the tag allows next-action selection in OmniFocus."),
});

export type TagUpdateToolInput = z.infer<typeof tagUpdateInputSchema>;

export interface TagUpdateContext {
  tagService: TagService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `tag_update`.
 */
export async function handleTagUpdate(input: TagUpdateToolInput, ctx: TagUpdateContext) {
  const { id, ...patch } = input;
  await ctx.tagService.update(id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.allowsNextAction !== undefined ? { allowsNextAction: patch.allowsNextAction } : {}),
  });
  return ok({}, ctx.makeMeta());
}

export function registerTagUpdateTool(server: McpServer, ctx: TagUpdateContext) {
  return server.registerTool(
    "tag_update",
    { description: TAG_UPDATE_DESCRIPTION, inputSchema: tagUpdateInputSchema.shape },
    async (args: TagUpdateToolInput) => {
      const envelope = await handleTagUpdate(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
