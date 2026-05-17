/**
 * `perspective_evaluate` MCP tool — evaluate an OmniFocus perspective.
 *
 * Unified for built-in and custom perspectives: the service inspects the id
 * and routes built-in ids (`"inbox"`, `"flagged"`, …) to JXA and custom ids
 * (opaque strings from `perspective_list`) to OmniJS (#55). Custom
 * perspectives require OmniFocus Pro and surface `FeatureRequiresPro` when
 * the edition lacks the runtime.
 *
 * Cursor pagination (#795): the service evaluates the full perspective and
 * the tool slices the result at the tool layer. The slice preserves the
 * perspective's natural order (forecast day-grouping, custom sort, etc.);
 * the cursor pins position by the last emitted task's id so re-evaluation
 * between pages stays stable as long as the perspective order is. Filter
 * hash includes `perspectiveId` and `fields[]` so changing either between
 * pages produces a clear ValidationError rather than silent re-sequencing.
 *
 * @see DESIGN.md §26
 * @see src/services/perspectiveService.ts
 * @see src/pagination/cursor.ts — cursor codec
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TASK_FIELD_NAMES, TASK_FIELD_NAMES_SET } from "../../domain/task.js";
import {
  ok,
  type Pagination,
  type ResponseMeta,
  toolResponse,
  warnUnknownFields,
} from "../../envelope/index.js";
import { applyProjection, validateFields } from "../../envelope/projection.js";
import { decodeCursor, encodeCursor, hashFilter } from "../../pagination/cursor.js";
import type { PerspectiveService } from "../../services/perspectiveService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PERSPECTIVE_EVALUATE_DESCRIPTION =
  "Evaluate an OmniFocus perspective and return its task list. " +
  "Accepts both built-in ids (inbox, projects, tags, forecast, flagged, nearby, review) " +
  "and custom-perspective ids obtained from perspective_list — the tool selects the " +
  "correct transport internally (JXA for built-in, OmniJS for custom). " +
  "Custom perspectives require OmniFocus Pro; otherwise returns an error with " +
  "code OF_FEATURE_REQUIRES_PRO. " +
  "Returns { tasks: Task[] } with cursor pagination (limit defaults to 50, max 200). " +
  "For 'review', returns [] — use review_list_due instead. " +
  "For 'nearby', returns [] (location unavailable). " +
  "No side effects; read-only. " +
  'Example: perspective_evaluate({ perspectiveId: "flagged" }) ' +
  'Example: perspective_evaluate({ perspectiveId: "flagged", limit: 50, cursor: "…" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const perspectiveEvaluateInputSchema = z.object({
  perspectiveId: z
    .string()
    .min(1)
    .describe(
      "OmniFocus perspective id. Accepts a built-in id " +
        "(inbox, projects, tags, forecast, flagged, nearby, review) or a custom-perspective " +
        "id from perspective_list (kind: custom).",
    ),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict each returned task to this list of top-level fields (id is always returned). " +
        "Omit for the full task shape. Empty array returns just id. " +
        "Unknown names are dropped silently and surface in meta.warnings.WARN_UNKNOWN_FIELDS. " +
        `Allowed: ${TASK_FIELD_NAMES.join(", ")}.`,
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Max results per page (1..200). Default 50. Use cursor to fetch subsequent pages."),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque cursor from a previous perspective_evaluate response. " +
        "Must use the same perspectiveId and fields — changing them mid-sequence returns a ValidationError.",
    ),
});

export type PerspectiveEvaluateToolInput = z.infer<typeof perspectiveEvaluateInputSchema>;

/** Default page size when `limit` is omitted. */
const DEFAULT_LIMIT = 50;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Minimum context the handler needs — injected by the registration helper. */
export interface PerspectiveEvaluateContext {
  perspectiveService: PerspectiveService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests without an McpServer.
 */
export async function handlePerspectiveEvaluate(
  input: PerspectiveEvaluateToolInput,
  ctx: PerspectiveEvaluateContext,
) {
  const result = await ctx.perspectiveService.evaluate(input.perspectiveId);

  // Cursor codec — the filter is {perspectiveId, fields}; changing either
  // mid-sequence trips a filterHash mismatch with the standard advisory.
  const filterHash = hashFilter({
    perspectiveId: input.perspectiveId,
    fields: input.fields ?? null,
  });
  const limit = input.limit ?? DEFAULT_LIMIT;

  let startIdx = 0;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(input.cursor, filterHash);
    // Locate the cursor's lastId in the current evaluation; if not found
    // (task was completed / dropped between pages) start from the top
    // rather than throwing — the new page is still useful.
    const idx = result.tasks.findIndex((t) => t.id === decoded.lastId);
    startIdx = idx === -1 ? 0 : idx + 1;
  }

  const slice = result.tasks.slice(startIdx, startIdx + limit);
  const hasMore = startIdx + limit < result.tasks.length;
  const lastTask = slice[slice.length - 1];
  const nextCursor =
    hasMore && lastTask !== undefined
      ? encodeCursor({ lastId: lastTask.id, lastSortValue: null, filterHash })
      : null;

  // Apply field projection after slicing — no point projecting tasks we
  // won't return.
  const projection =
    input.fields !== undefined ? validateFields(input.fields, TASK_FIELD_NAMES_SET) : undefined;
  const projectFields = projection?.valid;
  const tasks = slice.map((t) => applyProjection(t, projectFields));
  const warnings =
    projection !== undefined && projection.unknown.length > 0
      ? [warnUnknownFields([...projection.unknown], TASK_FIELD_NAMES)]
      : undefined;

  const pagination: Pagination = { cursor: nextCursor, hasMore };
  const meta = ctx.makeMeta({
    cacheHit: result.cacheHit,
    ...(warnings !== undefined ? { warnings } : {}),
  });
  return ok({ tasks }, meta, pagination);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register `perspective_evaluate` with an `McpServer` instance.
 */
export function registerPerspectiveEvaluateTool(
  server: McpServer,
  ctx: PerspectiveEvaluateContext,
) {
  return server.registerTool(
    "perspective_evaluate",
    {
      description: PERSPECTIVE_EVALUATE_DESCRIPTION,
      inputSchema: perspectiveEvaluateInputSchema.shape,
    },
    async (args: PerspectiveEvaluateToolInput) => {
      const envelope = await handlePerspectiveEvaluate(args, ctx);
      return toolResponse(envelope);
    },
  );
}
