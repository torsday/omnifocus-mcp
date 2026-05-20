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
import { PROJECT_FIELD_NAMES, PROJECT_FIELD_NAMES_SET } from "../../domain/project.js";
import { PROJECT_DEFAULTS, TASK_DEFAULTS } from "../../envelope/defaultsRegistry.js";
import { elideDefaults, elideDefaultsAll } from "../../envelope/elideDefaults.js";
import { ok, type ResponseMeta, toolResponse, warnUnknownFields } from "../../envelope/index.js";
import { applyProjection, validateFields } from "../../envelope/projection.js";
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
  verbose: z
    .boolean()
    .optional()
    .describe(
      "When true, return the full unelided shape (project + tasks). " +
        "Default: false — fields equal to their documented default are omitted from both. " +
        "See docs/token-cost.md for the defaults table.",
    ),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict the returned project to this list of top-level fields (id is always returned). " +
        "Omit for the full project shape. Empty array returns just id. " +
        "Unknown names surface in meta.warnings.WARN_UNKNOWN_FIELDS. " +
        "Note: only the project record is projected — attached tasks keep their full shape.",
    ),
  includeLinks: z
    .boolean()
    .optional()
    .describe(
      "When true, the project (and each attached task, if includeTaskTree=true) carries a " +
        "`_links` HATEOAS block. Default false — the block is omitted to save payload size. " +
        "Use the underlying ID fields (`id`, `folderId`, `projectId`, `parentId`, `tagIds`) directly instead.",
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
    ...(input.includeLinks !== undefined ? { includeLinks: input.includeLinks } : {}),
  });
  // Parse decision against the full note before projection.
  const decision = parseDecision(result.project.note);

  const projection =
    input.fields !== undefined ? validateFields(input.fields, PROJECT_FIELD_NAMES_SET) : undefined;
  const projectFields = projection?.valid;
  const warnings =
    projection !== undefined && projection.unknown.length > 0
      ? [warnUnknownFields([...projection.unknown], PROJECT_FIELD_NAMES)]
      : undefined;

  const projectedProject = applyProjection(result.project, projectFields);
  // fields[] = explicit projection → skip elide-defaults on the project record.
  const applyElide = input.verbose !== true && projectFields === undefined;
  const project = applyElide ? elideDefaults(projectedProject, PROJECT_DEFAULTS) : projectedProject;
  // Tasks are never projected (only the project record is), so apply elide-defaults
  // based on verbose only (not fields[]).
  const tasks =
    result.tasks === undefined
      ? undefined
      : input.verbose === true
        ? result.tasks
        : elideDefaultsAll(result.tasks, TASK_DEFAULTS);

  const meta = ctx.makeMeta({
    cacheHit: result.cacheHit,
    ...(warnings !== undefined ? { warnings } : {}),
  });

  const data: {
    project: typeof project;
    tasks?: typeof tasks;
    decision?: Decision;
  } = { project };
  if (tasks !== undefined) data.tasks = tasks;
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
