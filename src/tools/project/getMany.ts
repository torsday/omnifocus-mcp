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
import { type Decision, parseDecision } from "../../domain/decisionJournal.js";
import { ProjectId } from "../../domain/ids.js";
import { PROJECT_FIELD_NAMES, PROJECT_FIELD_NAMES_SET } from "../../domain/project.js";
import {
  ok,
  type ResponseMeta,
  toolResponse,
  type Warning,
  warnIdsNotFound,
  warnUnknownFields,
} from "../../envelope/index.js";
import { applyProjection, validateFields } from "../../envelope/projection.js";
import { ValidationError } from "../../errors/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PROJECT_GET_MANY_DESCRIPTION =
  "Fetch up to 100 projects by persistent ID in a single OmniFocus round-trip. " +
  "Use when you have a set of project IDs and need full project objects for all of them. " +
  "Do NOT use for a single ID — use project_get instead. " +
  "Returns Project[] in input order. Missing IDs are omitted and appear in meta.warnings. " +
  "Read-only; safe to retry. " +
  'Example: project_get_many({ ids: ["prj123", "prj456"] })';

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
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict each returned project to this list of top-level fields (id is always returned). " +
        "Omit for the full project shape. Empty array returns just id. " +
        "Unknown names are dropped silently and surface in meta.warnings.WARN_UNKNOWN_FIELDS. " +
        `Allowed: ${PROJECT_FIELD_NAMES.join(", ")}.`,
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

  const fullProjects = raw.filter((p): p is NonNullable<typeof p> => p !== null);
  const missing = input.ids.filter((_id, i) => raw[i] === null);

  // Parse decisions against the full note before projection.
  const decisions: Record<string, Decision> = {};
  for (const p of fullProjects) {
    const d = parseDecision(p.note);
    if (d !== undefined) decisions[p.id] = d;
  }
  const hasDecisions = Object.keys(decisions).length > 0;

  const projection =
    input.fields !== undefined ? validateFields(input.fields, PROJECT_FIELD_NAMES_SET) : undefined;
  const projectFields = projection?.valid;
  const projects = fullProjects.map((p) => applyProjection(p, projectFields));

  const warnings: Warning[] = [];
  if (missing.length > 0) warnings.push(warnIdsNotFound(missing));
  if (projection !== undefined && projection.unknown.length > 0) {
    warnings.push(warnUnknownFields([...projection.unknown], PROJECT_FIELD_NAMES));
  }
  const meta = ctx.makeMeta({ ...(warnings.length > 0 ? { warnings } : {}) });

  return ok({ projects, ...(hasDecisions && { decisions }) }, meta);
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
