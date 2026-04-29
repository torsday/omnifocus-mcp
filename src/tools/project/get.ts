/**
 * `project_get` MCP tool — fetch a single project by persistent ID.
 *
 * Optionally attaches the project's full task set (flat array; clients can
 * rebuild the nested tree via `parentId`). The task attachment is cached
 * behind a distinct key so `includeTaskTree=false` callers don't pay for
 * tree fetches.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/services/projectService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Decision, parseDecision } from "../../domain/decisionJournal.js";
import { ProjectId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ProjectService } from "../../services/projectService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PROJECT_GET_DESCRIPTION =
  "Fetch a single OmniFocus project by persistent ID. " +
  "Do NOT use for queries across projects — use project_list. " +
  "When includeTaskTree=true (default), the project's flat task list is attached. " +
  "Returns { project, tasks? }; safe to call repeatedly; no side effects. " +
  'Example: project_get({ id: "prj123" }) ' +
  'Example: project_get({ id: "prj123", includeTaskTree: false })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const projectGetInputSchema = z.object({
  id: ProjectId.schema.describe("Persistent project ID. Get from project_list or search_query."),
  includeTaskTree: z
    .boolean()
    .optional()
    .describe(
      "Whether to attach the project's tasks (flat array; clients rebuild the tree via parentId). " +
        "Default true. Set to false for a fast project-only read.",
    ),
});

export type ProjectGetToolInput = z.infer<typeof projectGetInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ProjectGetContext {
  projectService: ProjectService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly from unit tests.
 *
 * @throws NotFound when the project ID does not exist.
 */
export async function handleProjectGet(input: ProjectGetToolInput, ctx: ProjectGetContext) {
  const result = await ctx.projectService.get({
    id: input.id,
    ...(input.includeTaskTree !== undefined ? { includeTaskTree: input.includeTaskTree } : {}),
  });
  const meta = ctx.makeMeta({ cacheHit: result.cacheHit });
  const decision = parseDecision(result.project.note);
  const data: {
    project: typeof result.project;
    tasks?: typeof result.tasks;
    decision?: Decision;
  } = {
    project: result.project,
  };
  if (result.tasks !== undefined) data.tasks = result.tasks;
  if (decision !== undefined) data.decision = decision;
  return ok(data, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProjectGetTool(server: McpServer, ctx: ProjectGetContext) {
  return server.registerTool(
    "project_get",
    {
      description: PROJECT_GET_DESCRIPTION,
      inputSchema: projectGetInputSchema.shape,
    },
    async (args: ProjectGetToolInput) => {
      const envelope = await handleProjectGet(args, ctx);
      return toolResponse(envelope);
    },
  );
}
