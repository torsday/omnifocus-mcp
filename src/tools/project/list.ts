/**
 * `project_list` MCP tool — paginated project read surface.
 *
 * Mirrors `task_list` (DESIGN §26) in shape and semantics. Filters are narrow
 * by design: folder, status, flagged, review-due. Richer project queries
 * (e.g. tag-based) live in `search_query`.
 *
 * @see src/services/projectService.ts
 * @see src/tools/task/list.ts — sibling reference tool
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { aliasedEnum } from "../../domain/aliasedEnum.js";
import { FolderId } from "../../domain/ids.js";
import { ok, type Pagination, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ProjectListInput, ProjectService } from "../../services/projectService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PROJECT_LIST_DESCRIPTION =
  "List projects in OmniFocus with optional filters. " +
  "Use for queries across projects. " +
  "Do NOT use for a known single project (use project_get). " +
  "Filters: folderId, status, flagged, reviewDueBefore. " +
  "Returns projects[] with pagination; safe to call repeatedly; no side effects. " +
  "Example: project_list({}) " +
  'Example: project_list({ status: "active", folderId: "fld123" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const projectListInputSchema = z.object({
  folderId: FolderId.schema
    .optional()
    .describe(
      "Restrict to projects inside this folder. Get the ID from folder_list. Omit for all folders.",
    ),
  status: aliasedEnum(
    ["active", "on-hold", "done", "dropped"] as const,
    {
      paused: "on-hold",
      completed: "done",
      cancelled: "dropped",
    },
    "Restrict to projects with this status. " +
      "'active' = available; 'on-hold' = paused; 'done' = completed; 'dropped' = abandoned. " +
      "Omit for any status.",
  ).optional(),
  flagged: z
    .boolean()
    .optional()
    .describe("true = flagged only; false = unflagged only; omit = both."),
  reviewDueBefore: z
    .string()
    .optional()
    .describe(
      "Restrict to projects whose next review date is strictly before this moment. " +
        "ISO-8601 with offset (e.g. '2026-05-01T00:00:00-07:00'). " +
        "Projects without a review interval are excluded.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe(
      "Max projects per page (1..1000). Default 200. Use `cursor` to fetch subsequent pages.",
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque cursor from a previous project_list response. Must use the same filters — changing filters mid-sequence returns a ValidationError.",
    ),
});

export type ProjectListToolInput = z.infer<typeof projectListInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ProjectListContext {
  projectService: ProjectService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — separated from registration so unit tests can invoke it
 * without constructing an `McpServer`.
 */
export async function handleProjectList(input: ProjectListToolInput, ctx: ProjectListContext) {
  const serviceInput = input as ProjectListInput;
  const result = await ctx.projectService.list(serviceInput);
  const pagination: Pagination = {
    cursor: result.nextCursor,
    hasMore: result.hasMore,
  };
  const meta = ctx.makeMeta({ cacheHit: result.cacheHit });
  return ok({ projects: result.projects }, meta, pagination);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProjectListTool(server: McpServer, ctx: ProjectListContext) {
  return server.registerTool(
    "project_list",
    {
      description: PROJECT_LIST_DESCRIPTION,
      inputSchema: projectListInputSchema.shape,
    },
    async (args: ProjectListToolInput) => {
      const envelope = await handleProjectList(args, ctx);
      return toolResponse(envelope);
    },
  );
}
