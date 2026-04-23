/**
 * `tag_get` MCP tool — fetch a single tag by its persistent ID.
 *
 * Follows the reference implementation shape from DESIGN §26:
 * - Zod input schema with `.describe()` strings.
 * - Thin handler delegating to `TagService.get()`.
 * - ADR-0013 envelope via `ok()`.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/tagService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TagId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";
import type { TagService } from "../../services/tagService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TAG_GET_DESCRIPTION =
  "Fetch a single tag by its persistent ID, including task count. " +
  "Do not use to list multiple tags; prefer tag_list instead. " +
  "Returns tag details; no side effects.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const tagGetInputSchema = z.object({
  id: TagId.schema.describe("Persistent tag ID. Get from tag_list. IDs are stable across renames."),
});

export type TagGetToolInput = z.infer<typeof tagGetInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Minimum context the handler needs. */
export interface TagGetContext {
  tagService: TagService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests.
 */
export async function handleTagGet(input: TagGetToolInput, ctx: TagGetContext) {
  const result = await ctx.tagService.get(input.id);
  const meta = ctx.makeMeta({ cacheHit: result.cacheHit });
  return ok({ tag: result.tag }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register `tag_get` with an `McpServer` instance.
 */
export function registerTagGetTool(server: McpServer, ctx: TagGetContext) {
  return server.registerTool(
    "tag_get",
    {
      description: TAG_GET_DESCRIPTION,
      inputSchema: tagGetInputSchema.shape,
    },
    async (args: TagGetToolInput) => {
      const envelope = await handleTagGet(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
