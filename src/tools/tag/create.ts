/**
 * `tag_create` MCP tool — create a new tag in OmniFocus.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/tagService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TagId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";
import type { TagService } from "../../services/tagService.js";

export const TAG_CREATE_DESCRIPTION =
  "Create a new tag in OmniFocus. " +
  "Optionally nest it under an existing parent tag (get IDs from tag_list). " +
  "Returns the new tag's persistent ID. " +
  "Triggers a sync; call sync_trigger after to propagate to other devices.";

export const tagCreateInputSchema = z.object({
  name: z.string().min(1).describe("Tag name. Must be non-empty."),
  parentId: TagId.schema
    .optional()
    .describe("Parent tag ID to nest under. Omit for a root tag. Get from tag_list."),
  status: z
    .enum(["active", "on-hold"])
    .optional()
    .describe("Initial status. Defaults to 'active'. Cannot create a tag in 'dropped' state."),
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
  const result = await ctx.tagService.create({
    name: input.name,
    ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.allowsNextAction !== undefined ? { allowsNextAction: input.allowsNextAction } : {}),
  });
  const meta = ctx.makeMeta();
  return ok({ id: result.id }, meta);
}

export function registerTagCreateTool(server: McpServer, ctx: TagCreateContext) {
  return server.registerTool(
    "tag_create",
    { description: TAG_CREATE_DESCRIPTION, inputSchema: tagCreateInputSchema.shape },
    async (args: TagCreateToolInput) => {
      const envelope = await handleTagCreate(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
