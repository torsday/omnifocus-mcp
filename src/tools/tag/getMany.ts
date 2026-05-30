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
import { TAG_FIELD_NAMES, TAG_FIELD_NAMES_SET } from "../../domain/tag.js";
import { applyByteCapById } from "../../envelope/cap.js";
import {
  ok,
  type ResponseMeta,
  toolResponse,
  type Warning,
  warnIdsNotFound,
  warnResultTruncatedBytes,
  warnUnknownFields,
} from "../../envelope/index.js";
import { applyProjection, validateFields } from "../../envelope/projection.js";
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
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict each returned tag to this list of top-level fields (id is always returned). " +
        "Omit for the full tag shape. Empty array returns just id. " +
        "Unknown names are dropped silently and surface in meta.warnings.WARN_UNKNOWN_FIELDS. " +
        `Allowed: ${TAG_FIELD_NAMES.join(", ")}.`,
    ),
  maxOutputBytes: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Cap the serialized byte size of the returned tags[] array. When the response would exceed this, " +
        "the server returns as many whole tags as fit (in input order), sets meta.truncatedAtCap=true with " +
        "meta.bytesReturned and meta.itemsReturned, and lists the trimmed ids in meta.warnings.WARN_RESULT_TRUNCATED " +
        "details.droppedIds — re-request those in a smaller batch or with a higher cap. Omit for no cap. " +
        "Values above the server's hard ceiling (~1 MiB) are clamped. A single tag larger than the cap is still " +
        "returned whole so the batch always makes progress.",
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

  const fullTags = raw.filter((t): t is NonNullable<typeof t> => t !== null);
  const missing = input.ids.filter((_id, i) => raw[i] === null);

  const projection =
    input.fields !== undefined ? validateFields(input.fields, TAG_FIELD_NAMES_SET) : undefined;
  const projectFields = projection?.valid;
  const projected = fullTags.map((t) => applyProjection(t, projectFields));

  // Cap stage (#776/#1060) — runs last; no cursor on bulk-by-id, so report the
  // dropped tail by id (ADR-0024).
  const cap = applyByteCapById(projected, {
    ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
    idOf: (t) => (t as { id: string }).id,
  });

  const warnings: Warning[] = [];
  if (missing.length > 0) warnings.push(warnIdsNotFound(missing));
  if (projection !== undefined && projection.unknown.length > 0) {
    warnings.push(warnUnknownFields([...projection.unknown], TAG_FIELD_NAMES));
  }
  if (cap.truncatedAtCap) {
    warnings.push(warnResultTruncatedBytes(cap.bytesReturned, cap.itemsReturned, cap.droppedIds));
  }
  const meta = ctx.makeMeta({
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(cap.truncatedAtCap
      ? {
          truncatedAtCap: true,
          bytesReturned: cap.bytesReturned,
          itemsReturned: cap.itemsReturned,
        }
      : {}),
  });

  return ok({ tags: cap.items }, meta);
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
