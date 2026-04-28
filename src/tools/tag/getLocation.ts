/**
 * `tag_get_location` MCP tool — get the geographic location trigger on a tag.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/tagService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TagId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { TagService } from "../../services/tagService.js";

export const TAG_GET_LOCATION_DESCRIPTION =
  "Get the geographic location trigger currently set on a tag, or null if none. " +
  "Do not use to set or clear a location; prefer tag_set_location instead. " +
  "Location-based tags are an OmniFocus Pro feature. " +
  "Get the tag ID from tag_list. " +
  "Returns { location } with name, radius, and trigger direction, or null if unset. " +
  "Safe to call repeatedly; no side effects. " +
  'Example: tag_get_location({ id: "tag123" })';

export const tagGetLocationInputSchema = z.object({
  id: TagId.schema.describe("Persistent tag ID. Get from tag_list."),
});

export type TagGetLocationToolInput = z.infer<typeof tagGetLocationInputSchema>;

export interface TagGetLocationContext {
  tagService: TagService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `tag_get_location`.
 */
export async function handleTagGetLocation(
  input: TagGetLocationToolInput,
  ctx: TagGetLocationContext,
) {
  const result = await ctx.tagService.getLocation(input.id);
  const meta = ctx.makeMeta({ cacheHit: result.cacheHit });
  return ok({ location: result.location }, meta);
}

export function registerTagGetLocationTool(server: McpServer, ctx: TagGetLocationContext) {
  return server.registerTool(
    "tag_get_location",
    { description: TAG_GET_LOCATION_DESCRIPTION, inputSchema: tagGetLocationInputSchema.shape },
    async (args: TagGetLocationToolInput) => {
      const envelope = await handleTagGetLocation(args, ctx);
      return toolResponse(envelope);
    },
  );
}
