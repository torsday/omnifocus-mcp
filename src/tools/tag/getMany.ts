/**
 * `tag_get_many` MCP tool — fetch up to 100 tags by persistent ID in one
 * OmniFocus round-trip.
 *
 * @see src/tools/project/getMany.ts — mirror implementation for projects
 * @see src/tools/task/getMany.ts — mirror implementation for tasks
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { TagId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse, warnIdsNotFound } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TAG_GET_MANY_DESCRIPTION =
  "Fetch up to 100 tags by persistent ID in a single OmniFocus round-trip. " +
  "Use when you have a set of tag IDs and need full tag objects for all of them. " +
  "Do NOT use for a single ID — use tag_get instead. " +
  "Returns Tag[] in input order. Missing IDs are omitted and appear in meta.warnings. " +
  "Read-only; safe to retry. " +
  'Example: tag_get_many({ ids: ["tag123", "tag456"] })';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_IDS = 100;

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const tagGetManyInputSchema = z.object({
  ids: z
    .array(TagId.schema)
    .min(0)
    .max(MAX_IDS)
    .describe(
      `Array of tag IDs to fetch (0..${MAX_IDS}). Get IDs from tag_list. Missing IDs are omitted (not errors) and appear in meta.warnings.`,
    ),
});

export type TagGetManyInput = z.infer<typeof tagGetManyInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TagGetManyContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests.
 */
export async function handleTagGetMany(input: TagGetManyInput, ctx: TagGetManyContext) {
  if (input.ids.length === 0) {
    return ok({ tags: [] }, ctx.makeMeta());
  }

  if (input.ids.length > MAX_IDS) {
    throw new ValidationError(
      `ids array exceeds the maximum batch size of ${MAX_IDS} (got ${input.ids.length})`,
      { details: { field: "ids" } },
    );
  }

  const raw = await ctx.adapter.getTagsMany(input.ids);

  const tags = raw.filter((t): t is NonNullable<typeof t> => t !== null);
  const missing = input.ids.filter((_id, i) => raw[i] === null);

  const warnings = missing.length > 0 ? [warnIdsNotFound(missing)] : undefined;
  const meta = ctx.makeMeta({ ...(warnings !== undefined ? { warnings } : {}) });

  return ok({ tags }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTagGetManyTool(server: McpServer, ctx: TagGetManyContext) {
  return server.registerTool(
    "tag_get_many",
    {
      description: TAG_GET_MANY_DESCRIPTION,
      inputSchema: tagGetManyInputSchema.shape,
    },
    async (args: TagGetManyInput) => {
      const envelope = await handleTagGetMany(args, ctx);
      return toolResponse(envelope);
    },
  );
}
