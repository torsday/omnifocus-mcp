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
import { ok, type Pagination, type ResponseMeta, toolResponse } from "../../envelope/index.js";
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
      "'exclude' = active tasks only; 'only' = completed only; 'any' = both. Default 'any'.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Max results per page (1..500). Default 100."),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque cursor from a previous search_query response. Must use identical filters — changing filters returns a ValidationError.",
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
  };

  const result = await ctx.searchService.search(serviceInput);
  const pagination: Pagination = {
    cursor: result.nextCursor,
    hasMore: result.hasMore,
  };
  const meta = ctx.makeMeta({ cacheHit: result.cacheHit });
  return ok({ tasks: result.tasks }, meta, pagination);
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
