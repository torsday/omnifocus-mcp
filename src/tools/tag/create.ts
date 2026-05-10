/**
 * `tag_create` MCP tool — create a new tag in OmniFocus.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/tagService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { aliasedEnum } from "../../domain/aliasedEnum.js";
import { TagId } from "../../domain/ids.js";
import { NAME_MAX_CHARS } from "../../domain/inputLimits.js";
import { summaryTagCreate } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { TagService } from "../../services/tagService.js";

export const TAG_CREATE_DESCRIPTION =
  "Create a new tag in OmniFocus. " +
  "Optionally nest it under an existing parent tag (get IDs from tag_list). " +
  "Do not use to move an existing tag; prefer tag_move instead. " +
  "Returns the new tag's persistent ID. " +
  "Triggers a sync; call sync_trigger after to propagate to other devices. " +
  'Example: tag_create({ name: "errands" }) ' +
  'Example: tag_create({ name: "home", parentId: "tag123" })';

export const tagCreateInputSchema = z.object({
  name: z.string().min(1).max(NAME_MAX_CHARS, "max 1 KB").describe("Tag name. Must be non-empty."),
  parentId: TagId.schema
    .optional()
    .describe("Parent tag ID to nest under. Omit for a root tag. Get from tag_list."),
  status: aliasedEnum(
    ["active", "on-hold"] as const,
    { paused: "on-hold" },
    "Initial status. Defaults to 'active'. Cannot create a tag in 'dropped' state.",
  ).optional(),
  allowsNextAction: z
    .boolean()
    .optional()
    .describe("Whether the tag allows next-action selection. Defaults to true."),
});

export type TagCreateToolInput = z.infer<typeof tagCreateInputSchema>;

export interface TagCreateContext {
  tagService: TagService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `tag_create`.
 */
export async function handleTagCreate(input: TagCreateToolInput, ctx: TagCreateContext) {
  const createResult = await ctx.tagService.create({
    name: input.name,
    ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.allowsNextAction !== undefined ? { allowsNextAction: input.allowsNextAction } : {}),
  });
  const { tag } = await ctx.tagService.get(createResult.id);
  const meta = ctx.makeMeta({
    syncPending: true,
    humanReadableSummary: summaryTagCreate(input.name),
  });
  return ok({ tag }, meta);
}

export function registerTagCreateTool(server: McpServer, ctx: TagCreateContext) {
  return server.registerTool(
    "tag_create",
    { description: TAG_CREATE_DESCRIPTION, inputSchema: tagCreateInputSchema.shape },
    async (args: TagCreateToolInput) => {
      const envelope = await handleTagCreate(args, ctx);
      return toolResponse(envelope);
    },
  );
}
