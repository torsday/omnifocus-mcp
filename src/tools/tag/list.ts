/**
 * `tag_list` MCP tool — list tags in OmniFocus.
 *
 * Follows the reference implementation shape from DESIGN §26 / `task_list`:
 * - Zod input schema with `.describe()` strings as the LLM-facing contract.
 * - Thin handler (< 30 LOC) delegating to `TagService`.
 * - ADR-0013 envelope via `ok()`.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/tagService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TagId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";
import type { TagListInput, TagService } from "../../services/tagService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TAG_LIST_DESCRIPTION =
  "List all tags in OmniFocus, optionally filtered by parent tag or status. " +
  "Do not use to fetch a single tag by ID; prefer tag_get instead. " +
  "Returns a flat array — use parentId to walk the hierarchy one level at a time. " +
  "Safe to call repeatedly; no side effects.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const tagListInputSchema = z.object({
  parentId: TagId.schema
    .optional()
    .describe(
      "Return only direct children of this tag. Get the ID from a previous tag_list call. Omit for root tags.",
    ),
  status: z
    .enum(["active", "on-hold", "dropped"])
    .optional()
    .describe("Filter by tag status. Omit to return tags of all statuses."),
});

export type TagListToolInput = z.infer<typeof tagListInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Minimum context the handler needs — injected by the registration helper. */
export interface TagListContext {
  tagService: TagService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests without an McpServer.
 */
export async function handleTagList(input: TagListToolInput, ctx: TagListContext) {
  const serviceInput: TagListInput = {
    ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  };
  const result = await ctx.tagService.list(serviceInput);
  const meta = ctx.makeMeta({ cacheHit: result.cacheHit });
  return ok({ tags: result.tags }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register `tag_list` with an `McpServer` instance.
 */
export function registerTagListTool(server: McpServer, ctx: TagListContext) {
  return server.registerTool(
    "tag_list",
    {
      description: TAG_LIST_DESCRIPTION,
      inputSchema: tagListInputSchema.shape,
    },
    async (args: TagListToolInput) => {
      const envelope = await handleTagList(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
