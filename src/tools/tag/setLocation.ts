/**
 * `tag_set_location` MCP tool — set a geographic location trigger on a tag.
 *
 * Location-based tags are an OmniFocus Pro feature. On Standard installs the
 * JXA adapter surfaces a `FeatureRequiresPro` error which propagates through
 * this tool unchanged.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/tagService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TagId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";
import type { TagService } from "../../services/tagService.js";

export const TAG_SET_LOCATION_DESCRIPTION =
  "Set a geographic location trigger on a tag (OmniFocus Pro only). " +
  "The trigger fires when arriving at, leaving, or both for the specified radius. " +
  "Do not use to read the current location; prefer tag_get_location instead. " +
  "Get the tag ID from tag_list. " +
  "Returns FeatureRequiresPro on OmniFocus Standard installs. " +
  "Triggers a sync; call sync_trigger after to propagate to other devices.";

export const tagSetLocationInputSchema = z.object({
  id: TagId.schema.describe("Persistent tag ID. Get from tag_list."),
  latitude: z.number().min(-90).max(90).describe("Latitude in decimal degrees (−90 to 90)."),
  longitude: z.number().min(-180).max(180).describe("Longitude in decimal degrees (−180 to 180)."),
  radiusMeters: z.number().min(0).describe("Trigger radius in metres. Must be ≥ 0."),
  trigger: z
    .enum(["entering", "leaving", "both"])
    .describe("When to trigger: 'entering', 'leaving', or 'both'."),
  name: z
    .string()
    .nullable()
    .optional()
    .describe("Optional human-readable name for the location (e.g. 'Home', 'Office')."),
});

export type TagSetLocationToolInput = z.infer<typeof tagSetLocationInputSchema>;

export interface TagSetLocationContext {
  tagService: TagService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `tag_set_location`.
 */
export async function handleTagSetLocation(
  input: TagSetLocationToolInput,
  ctx: TagSetLocationContext,
) {
  await ctx.tagService.setLocation(input.id, {
    name: input.name ?? null,
    latitude: input.latitude,
    longitude: input.longitude,
    radiusMeters: input.radiusMeters,
    trigger: input.trigger,
  });
  const { tag } = await ctx.tagService.get(input.id);
  return ok({ tag }, ctx.makeMeta({ syncPending: true }));
}

export function registerTagSetLocationTool(server: McpServer, ctx: TagSetLocationContext) {
  return server.registerTool(
    "tag_set_location",
    { description: TAG_SET_LOCATION_DESCRIPTION, inputSchema: tagSetLocationInputSchema.shape },
    async (args: TagSetLocationToolInput) => {
      const envelope = await handleTagSetLocation(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
