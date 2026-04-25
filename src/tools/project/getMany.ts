/**
 * `project_get_many` MCP tool — fetch up to 100 projects by persistent ID
 * in one OmniFocus round-trip.
 *
 * Agents accumulating project IDs from multiple sources (project_list,
 * resource reads, task results) can hydrate all of them in a single call
 * rather than N serial `project_get` calls.
 *
 * ## Behaviour
 *
 * - Projects are returned in the **same order** as the input `ids` array.
 * - IDs that are not found are **omitted** from the result — they are **not**
 *   errors. They surface in `meta.warnings` under the `WARN_IDS_NOT_FOUND`
 *   code with `details.missing` listing the IDs.
 * - An empty `ids` array returns `[]` immediately without touching OmniFocus.
 * - Passing more than 100 IDs returns a `ValidationError`.
 *
 * @see DESIGN.md §26 — tool pattern
 * @see src/tools/task/getMany.ts — mirror implementation for tasks
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ProjectId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse, warnIdsNotFound } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PROJECT_GET_MANY_DESCRIPTION =
  "Fetch up to 100 projects by persistent ID in a single OmniFocus round-trip. " +
  "Use when you have a set of project IDs and need full project objects for all of them. " +
  "Do NOT use for a single ID — use project_get instead. " +
  "Returns Project[] in input order. Missing IDs are omitted and appear in meta.warnings. " +
  "Read-only; safe to retry.";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_IDS = 100;

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const projectGetManyInputSchema = z.object({
  ids: z
    .array(ProjectId.schema)
    .min(0)
    .max(MAX_IDS)
    .describe(
      `Array of project IDs to fetch (0..${MAX_IDS}). Get IDs from project_list. Missing IDs are omitted (not errors) and appear in meta.warnings.`,
    ),
});

export type ProjectGetManyInput = z.infer<typeof projectGetManyInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface ProjectGetManyContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests.
 */
export async function handleProjectGetMany(input: ProjectGetManyInput, ctx: ProjectGetManyContext) {
  if (input.ids.length === 0) {
    return ok({ projects: [] }, ctx.makeMeta());
  }

  if (input.ids.length > MAX_IDS) {
    throw new ValidationError(
      `ids array exceeds the maximum batch size of ${MAX_IDS} (got ${input.ids.length})`,
      { details: { field: "ids" } },
    );
  }

  const raw = await ctx.adapter.getProjectsMany(input.ids);

  const projects = raw.filter((p): p is NonNullable<typeof p> => p !== null);
  const missing = input.ids.filter((_id, i) => raw[i] === null);

  const warnings = missing.length > 0 ? [warnIdsNotFound(missing)] : undefined;
  const meta = ctx.makeMeta({ ...(warnings !== undefined ? { warnings } : {}) });

  return ok({ projects }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProjectGetManyTool(server: McpServer, ctx: ProjectGetManyContext) {
  return server.registerTool(
    "project_get_many",
    {
      description: PROJECT_GET_MANY_DESCRIPTION,
      inputSchema: projectGetManyInputSchema.shape,
    },
    async (args: ProjectGetManyInput) => {
      const envelope = await handleProjectGetMany(args, ctx);
      return toolResponse(envelope);
    },
  );
}
