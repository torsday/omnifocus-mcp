/**
 * `search_query` MCP tool — full-text search across OmniFocus tasks.
 *
 * Matches `q` against task name, note, or both (controlled by `scope`).
 * Additional filter fields narrow the result set. Cursor pagination is
 * identical to `task_list` — cursors are filter-locked (ValidationError
 * if filters change mid-sequence).
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/searchService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ProjectId, TagId } from "../../domain/ids.js";
import { SEARCH_QUERY_MAX_CHARS } from "../../domain/inputLimits.js";
import { TASK_FIELD_NAMES, TASK_FIELD_NAMES_SET, type Task } from "../../domain/task.js";
import { applyByteCap } from "../../envelope/cap.js";
import {
  ok,
  type Pagination,
  type ResponseMeta,
  toolResponse,
  type Warning,
  warnResultTruncatedBytes,
  warnUnknownFields,
} from "../../envelope/index.js";
import { applyProjection, validateFields } from "../../envelope/projection.js";
import type { SearchInput, SearchService } from "../../services/searchService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const SEARCH_QUERY_DESCRIPTION =
  "Full-text search across OmniFocus task names and/or notes. " +
  "Use for finding tasks by content when you don't know the ID. " +
  "Supports optional filters (project, tags, flagged, completion status) and cursor pagination. " +
  "Do NOT use when a known task ID is available (use task_get instead). " +
  "Returns tasks[] with pagination; safe to call repeatedly; no side effects. " +
  'Example: search_query({ q: "dentist" }) ' +
  'Example: search_query({ q: "report", projectId: "prj123", completed: "exclude" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const searchQueryInputSchema = z.object({
  q: z
    .string()
    .max(SEARCH_QUERY_MAX_CHARS, "max 4 KB")
    .describe(
      "Search query. Case-insensitive substring match. Empty string matches all tasks (useful with filters).",
    ),
  scope: z
    .enum(["name", "note", "all"])
    .optional()
    .describe(
      "'name' = search task names only; 'note' = search notes only; 'all' = both. Default 'all'.",
    ),
  projectId: ProjectId.schema
    .optional()
    .describe("Restrict to tasks in this project. Get the ID from project_list."),
  tagIds: z
    .array(TagId.schema)
    .optional()
    .describe("Restrict to tasks carrying ALL of these tags. Get IDs from tag_list."),
  flagged: z
    .boolean()
    .optional()
    .describe("true = flagged tasks only; false = unflagged only; omit = all."),
  completed: z
    .enum(["any", "only", "exclude"])
    .optional()
    .describe(
      "'exclude' = active tasks only; 'only' = completed only; 'any' = both. Default 'exclude'.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Max results per page (1..500). Default 50."),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque cursor from a previous search_query response. Must use identical filters — changing filters returns a ValidationError.",
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
  includeLinks: z
    .boolean()
    .optional()
    .describe(
      "When true, each task carries a `_links` HATEOAS block (self, project, parent, tags). " +
        "Default false — the block is omitted to save payload size. " +
        "Use the task's `id`, `projectId`, `parentId`, and `tagIds` fields directly instead.",
    ),
  maxOutputBytes: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Cap the serialized byte size of the returned tasks[] array. When the response would exceed this, " +
        "the server returns as many whole tasks as fit, sets meta.truncatedAtCap=true with " +
        "meta.bytesReturned and meta.itemsReturned, and returns a pagination cursor that resumes at the " +
        "first dropped task. Omit for no cap. Values above the server's hard ceiling (~1 MiB) are clamped. " +
        "A single task larger than the cap is still returned whole so pagination always advances.",
    ),
});

export type SearchQueryToolInput = z.infer<typeof searchQueryInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface SearchQueryContext {
  searchService: SearchService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests.
 */
export async function handleSearchQuery(input: SearchQueryToolInput, ctx: SearchQueryContext) {
  const serviceInput: SearchInput = {
    q: input.q,
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.tagIds !== undefined ? { tagIds: input.tagIds } : {}),
    ...(input.flagged !== undefined ? { flagged: input.flagged } : {}),
    ...(input.completed !== undefined ? { completed: input.completed } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    ...(input.includeLinks !== undefined ? { includeLinks: input.includeLinks } : {}),
  };

  const result = await ctx.searchService.search(serviceInput);

  const projection =
    input.fields !== undefined ? validateFields(input.fields, TASK_FIELD_NAMES_SET) : undefined;
  const projectFields = projection?.valid;
  const fieldWarnings =
    projection !== undefined && projection.unknown.length > 0
      ? [warnUnknownFields([...projection.unknown], TASK_FIELD_NAMES)]
      : [];
  const wireTasks = result.tasks.map((t) => applyProjection(t, projectFields));

  // Cap stage (#776/#1059) — runs last; re-anchor the cursor at the last kept task.
  const cap = applyByteCap(wireTasks, {
    ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
    cursorFor: (lastKeptIndex) =>
      ctx.searchService.cursorForResultItem(result.tasks[lastKeptIndex] as Task, serviceInput),
  });

  const pagination: Pagination = cap.truncatedAtCap
    ? { cursor: cap.cursor, hasMore: true }
    : { cursor: result.nextCursor, hasMore: result.hasMore };

  const warnings: Warning[] = cap.truncatedAtCap
    ? [...fieldWarnings, warnResultTruncatedBytes(cap.bytesReturned, cap.itemsReturned)]
    : fieldWarnings;

  const meta = ctx.makeMeta({
    cacheHit: result.cacheHit,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(cap.truncatedAtCap
      ? {
          truncatedAtCap: true,
          bytesReturned: cap.bytesReturned,
          itemsReturned: cap.itemsReturned,
        }
      : {}),
  });
  return ok({ tasks: cap.items }, meta, pagination);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerSearchQueryTool(server: McpServer, ctx: SearchQueryContext) {
  return server.registerTool(
    "search_query",
    {
      description: SEARCH_QUERY_DESCRIPTION,
      inputSchema: searchQueryInputSchema.shape,
    },
    async (args: SearchQueryToolInput) => {
      const envelope = await handleSearchQuery(args, ctx);
      return toolResponse(envelope);
    },
  );
}
