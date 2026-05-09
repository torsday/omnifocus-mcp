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
import { TAG_DEFAULTS } from "../../envelope/defaultsRegistry.js";
import { elideDefaultsAll } from "../../envelope/elideDefaults.js";
import { ok, type ResponseMeta, toolResponse, warnUnknownFields } from "../../envelope/index.js";
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
  const tags = applyElide
    ? elideDefaultsAll(result.tags, TAG_DEFAULTS)
    : result.tags.map((t) => applyProjection(t, projectFields));

  const meta = ctx.makeMeta({
    cacheHit: result.cacheHit,
    ...(warnings !== undefined ? { warnings } : {}),
  });
  return ok({ tags }, meta);
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
