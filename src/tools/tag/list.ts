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
import { aliasedEnum } from "../../domain/aliasedEnum.js";
import { TagId } from "../../domain/ids.js";
import { TAG_FIELD_NAMES, TAG_FIELD_NAMES_SET } from "../../domain/tag.js";
import { applyByteCapById } from "../../envelope/cap.js";
import { TAG_DEFAULTS } from "../../envelope/defaultsRegistry.js";
import { elideDefaultsAll } from "../../envelope/elideDefaults.js";
import {
  ok,
  type ResponseMeta,
  toolResponse,
  type Warning,
  warnResultTruncatedBytes,
  warnUnknownFields,
} from "../../envelope/index.js";
import { applyProjection, validateFields } from "../../envelope/projection.js";
import type { TagListInput, TagService } from "../../services/tagService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TAG_LIST_DESCRIPTION =
  "List all tags in OmniFocus, optionally filtered by parent tag or status. " +
  "Do not use to fetch a single tag by ID; prefer tag_get instead. " +
  "Returns a flat array — use parentId to walk the hierarchy one level at a time. " +
  "Safe to call repeatedly; no side effects. " +
  "Example: tag_list({}) " +
  'Example: tag_list({ status: "active", parentId: "tag123" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const tagListInputSchema = z.object({
  parentId: TagId.schema
    .optional()
    .describe(
      "Return only direct children of this tag. Get the ID from a previous tag_list call. Omit for root tags.",
    ),
  status: aliasedEnum(
    ["active", "on-hold", "dropped"] as const,
    {
      paused: "on-hold",
      cancelled: "dropped",
      archived: "dropped",
    },
    "Filter by tag status. Omit to return tags of all statuses.",
  ).optional(),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "When true, return the full unelided tag shape. " +
        "Default: false — fields equal to their documented default (status: 'active', " +
        "parentId: null, location: null, allowsNextAction: true) are omitted. " +
        "See docs/token-cost.md for the defaults table.",
    ),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict each returned tag to this list of top-level fields (id is always returned). " +
        "Omit for the full tag shape. Empty array returns just id. " +
        "Unknown names surface in meta.warnings.WARN_UNKNOWN_FIELDS.",
    ),
  maxOutputBytes: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Cap the serialized byte size of the returned tags[] array. When the response would exceed this, " +
        "the server returns as many whole tags as fit, sets meta.truncatedAtCap=true with meta.bytesReturned " +
        "and meta.itemsReturned, and lists the trimmed ids in meta.warnings.WARN_RESULT_TRUNCATED " +
        "details.droppedIds — narrow with parentId/status, fetch those ids via tag_get_many, or raise the cap. " +
        "Omit for no cap. Values above the server's hard ceiling (~1 MiB) are clamped. A single tag larger than " +
        "the cap is still returned whole so the response always makes progress.",
    ),
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

  const projection =
    input.fields !== undefined ? validateFields(input.fields, TAG_FIELD_NAMES_SET) : undefined;
  const projectFields = projection?.valid;
  const warnings =
    projection !== undefined && projection.unknown.length > 0
      ? [warnUnknownFields([...projection.unknown], TAG_FIELD_NAMES)]
      : undefined;

  // fields[] = explicit mode → skip elide-defaults.
  const applyElide = input.verbose !== true && projectFields === undefined;
  const wireTags = applyElide
    ? elideDefaultsAll(result.tags, TAG_DEFAULTS)
    : result.tags.map((t) => applyProjection(t, projectFields));

  // Cap stage (#776/#1062) — runs last. tag_list has no cursor, so the trimmed
  // tail is reported by id (ADR-0024) rather than via a continuation cursor.
  const cap = applyByteCapById(wireTags, {
    ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
    idOf: (t) => (t as { id: string }).id,
  });

  const allWarnings: Warning[] = [
    ...(warnings ?? []),
    ...(cap.truncatedAtCap
      ? [warnResultTruncatedBytes(cap.bytesReturned, cap.itemsReturned, cap.droppedIds)]
      : []),
  ];

  const meta = ctx.makeMeta({
    cacheHit: result.cacheHit,
    ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
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
      return toolResponse(envelope);
    },
  );
}
