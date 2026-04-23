/**
 * `tag_set_allows_next_action` MCP tool — toggle next-action selection on a tag.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/tagService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TagId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";
import type { TagService } from "../../services/tagService.js";

export const TAG_SET_ALLOWS_NEXT_ACTION_DESCRIPTION =
  "Enable or disable next-action selection for a tag in OmniFocus. " +
  "When true, tasks with this tag are eligible for next-action promotion. " +
  "Get the tag ID from tag_list. " +
  "Triggers a sync; call sync_trigger after to propagate to other devices.";

export const tagSetAllowsNextActionInputSchema = z.object({
  id: TagId.schema.describe("Persistent tag ID. Get from tag_list."),
  allowsNextAction: z.boolean().describe("true to enable next-action selection; false to disable."),
});

export type TagSetAllowsNextActionToolInput = z.infer<typeof tagSetAllowsNextActionInputSchema>;

export interface TagSetAllowsNextActionContext {
  tagService: TagService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `tag_set_allows_next_action`.
 */
export async function handleTagSetAllowsNextAction(
  input: TagSetAllowsNextActionToolInput,
  ctx: TagSetAllowsNextActionContext,
) {
  await ctx.tagService.setAllowsNextAction(input.id, input.allowsNextAction);
  const { tag } = await ctx.tagService.get(input.id);
  return ok({ tag }, ctx.makeMeta({ syncPending: true }));
}

export function registerTagSetAllowsNextActionTool(
  server: McpServer,
  ctx: TagSetAllowsNextActionContext,
) {
  return server.registerTool(
    "tag_set_allows_next_action",
    {
      description: TAG_SET_ALLOWS_NEXT_ACTION_DESCRIPTION,
      inputSchema: tagSetAllowsNextActionInputSchema.shape,
    },
    async (args: TagSetAllowsNextActionToolInput) => {
      const envelope = await handleTagSetAllowsNextAction(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
