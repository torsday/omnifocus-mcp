/**
 * `tag_update` MCP tool — update mutable fields on an existing tag (partial patch).
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/tagService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { aliasedEnum } from "../../domain/aliasedEnum.js";
import { TagId } from "../../domain/ids.js";
import { NAME_MAX_CHARS } from "../../domain/inputLimits.js";
import { summaryTagUpdate } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { TagService } from "../../services/tagService.js";

export const TAG_UPDATE_DESCRIPTION =
  "Update mutable fields on an existing tag (partial patch). " +
  "Only supplied fields are changed; omit a field to leave it unchanged. " +
  "Do not use to move a tag to a different parent; prefer tag_move instead. " +
  "Get the tag ID from tag_list. " +
  "Returns the updated tag on success. " +
  "Triggers a sync; call sync_trigger after to propagate to other devices. " +
  'Example: tag_update({ id: "tag123", name: "shopping" }) ' +
  'Example: tag_update({ id: "tag123", status: "dropped" })';

export const tagUpdateInputSchema = z.object({
  id: TagId.schema.describe("Persistent tag ID. Get from tag_list."),
  name: z
    .string()
    .min(1)
    .max(NAME_MAX_CHARS, "max 1 KB")
    .optional()
    .describe("New tag name. Must be non-empty if supplied."),
  parentId: TagId.schema
    .nullable()
    .optional()
    .describe("New parent tag ID. Pass null to promote to root. Get from tag_list."),
  status: aliasedEnum(
    ["active", "on-hold", "dropped"] as const,
    { paused: "on-hold", cancelled: "dropped", archived: "dropped" },
    "New lifecycle status.",
  ).optional(),
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
  const { tag } = await ctx.tagService.get(id);
  return ok(
    { tag },
    ctx.makeMeta({ syncPending: true, humanReadableSummary: summaryTagUpdate(tag.name) }),
  );
}

export function registerTagUpdateTool(server: McpServer, ctx: TagUpdateContext) {
  return server.registerTool(
    "tag_update",
    { description: TAG_UPDATE_DESCRIPTION, inputSchema: tagUpdateInputSchema.shape },
    async (args: TagUpdateToolInput) => {
      const envelope = await handleTagUpdate(args, ctx);
      return toolResponse(envelope);
    },
  );
}
