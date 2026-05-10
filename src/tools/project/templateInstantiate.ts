/**
 * `project_template_instantiate` MCP tool — spawn a project from a saved template.
 *
 * Resolves a template by name within the configured Templates folder
 * (`OMNIFOCUS_TEMPLATES_FOLDER_NAME`), validates that every recorded
 * parameter has a value supplied, performs `{{name}}` substitution and
 * optional relative-date shifting, pre-creates the target project, then
 * hands the modified TaskPaper body to the existing `importTaskPaper`
 * flow which creates the task tree.
 *
 * @see #587 — feature spec
 * @see #472 — parent template feature
 * @see src/domain/projectTemplates.ts — extract / substitute / shift helpers
 * @see src/services/exportService.ts — TaskPaper importer
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateProjectMutation } from "../../cache/invalidation.js";
import { FolderId } from "../../domain/ids.js";
import {
  extractProjectTemplateBody,
  findTemplateAnchorDate,
  parseProjectTemplateMeta,
  shiftTemplateDates,
  substituteTemplateParameters,
} from "../../domain/projectTemplates.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { NotFound, ValidationError } from "../../errors/index.js";
import { ExportService } from "../../services/exportService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PROJECT_TEMPLATE_INSTANTIATE_DESCRIPTION =
  "Spawn a new project from a saved template under the Templates folder. " +
  "Substitutes {{name}} placeholders with the supplied parameters and shifts " +
  "@due / @defer dates relative to the optional dueDate anchor (the earliest " +
  "@due in the template). " +
  "Do NOT use to copy a one-off project — prefer task_duplicate. " +
  "Returns { projectId, taskCount, importWarnings }. " +
  "Side effects: writes a new project + tasks; sets meta.syncPending = true. " +
  'Example: { templateName: "Client onboarding", parameters: { client: "Acme" }, dueDate: "2026-06-04" }.';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const projectTemplateInstantiateInputSchema = z.object({
  templateName: z.string().min(1).describe("Saved template to instantiate."),
  parameters: z
    .record(z.string(), z.string())
    .default({})
    .describe("Map of placeholder name → substitution value."),
  targetFolderId: FolderId.schema
    .optional()
    .describe("Folder to create the new project in. Defaults to the library root."),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional()
    .describe(
      "Anchor for relative-date shifting. The earliest @due in the template " +
        "becomes this date; every other @due/@defer shifts by the same delta.",
    ),
});

export type ProjectTemplateInstantiateToolInput = z.infer<
  typeof projectTemplateInstantiateInputSchema
>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TemplateNotFoundError extends NotFound {
  constructor(name: string) {
    super(`No template named "${name}" was found in the Templates folder.`, {
      suggestion:
        "List available templates with project_template_list, then retry with a valid name.",
      details: { templateName: name },
    });
  }
}

export class MissingTemplateParameterError extends ValidationError {
  /** Names of the missing parameters (also available in `details.missing`). */
  readonly missing: string[];
  constructor(missing: string[]) {
    super(
      `Template requires parameters not supplied: ${missing.map((n) => `"${n}"`).join(", ")}.`,
      {
        suggestion:
          "Provide values for all required template parameters listed in `details.missing`.",
        details: { missing },
      },
    );
    this.missing = missing;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ProjectTemplateInstantiateContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
  /** Folder name used to hold templates. Resolved from `OMNIFOCUS_TEMPLATES_FOLDER_NAME`. */
  templatesFolderName: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Pure handler for `project_template_instantiate`.
 *
 * @throws {TemplateNotFoundError} when no template matches `templateName`
 * @throws {MissingTemplateParameterError} when the template has parameters
 *   not supplied in the input `parameters` map
 */
export async function handleProjectTemplateInstantiate(
  input: ProjectTemplateInstantiateToolInput,
  ctx: ProjectTemplateInstantiateContext,
) {
  const folders = await ctx.adapter.listFolders();
  const folderKey = ctx.templatesFolderName.toLowerCase();
  const templatesFolder = folders.find((f) => f.name.toLowerCase() === folderKey);
  if (templatesFolder === undefined) {
    throw new TemplateNotFoundError(input.templateName);
  }

  const projects = await ctx.adapter.listProjects({ folderId: templatesFolder.id });
  const nameKey = input.templateName.toLowerCase();
  const templateProject = projects.find((p) => p.name.toLowerCase() === nameKey);
  if (templateProject === undefined) {
    throw new TemplateNotFoundError(input.templateName);
  }

  const meta = parseProjectTemplateMeta(templateProject.note);
  if (meta === undefined) {
    // A project sitting in Templates with no fence isn't a valid template.
    throw new TemplateNotFoundError(input.templateName);
  }

  // Validate every recorded parameter has a value. Report all missing at
  // once so the agent can fix them in one round-trip rather than discovering
  // them one at a time.
  const missing = meta.parameterNames.filter((name) => !Object.hasOwn(input.parameters, name));
  if (missing.length > 0) {
    throw new MissingTemplateParameterError(missing);
  }

  let body = extractProjectTemplateBody(templateProject.note);
  body = substituteTemplateParameters(body, input.parameters);

  // Date shifting: only when the user supplied a target dueDate AND the
  // template has an anchor to shift from. Templates without @due dates have
  // nothing to shift; we still substitute parameters and import as-is.
  if (input.dueDate !== undefined) {
    const anchor = findTemplateAnchorDate(body);
    if (anchor !== undefined) {
      body = shiftTemplateDates(body, anchor, input.dueDate);
    }
  }

  // Pre-create the target project so the importer drops tasks into it
  // directly. Passing targetProjectId tells importTaskPaper to ignore the
  // `Project name:` heading at the top of the body.
  const projectId = await ctx.adapter.createProject({
    name: input.templateName,
    ...(input.targetFolderId !== undefined && { folderId: input.targetFolderId }),
  });

  const exporter = new ExportService({ adapter: ctx.adapter });
  const importResult = await exporter.importTaskPaper(body, projectId);

  if (ctx.cache !== undefined) {
    invalidateProjectMutation(ctx.cache, { projectId });
  }

  return ok(
    {
      projectId,
      taskCount: importResult.created.length,
      ...(importResult.warnings.length > 0 && { importWarnings: importResult.warnings }),
    },
    ctx.makeMeta({ syncPending: true }),
  );
}

export function registerProjectTemplateInstantiateTool(
  server: McpServer,
  ctx: ProjectTemplateInstantiateContext,
) {
  return server.registerTool(
    "project_template_instantiate",
    {
      description: PROJECT_TEMPLATE_INSTANTIATE_DESCRIPTION,
      inputSchema: projectTemplateInstantiateInputSchema.shape,
    },
    async (args: ProjectTemplateInstantiateToolInput) => {
      const envelope = await handleProjectTemplateInstantiate(args, ctx);
      return toolResponse(envelope);
    },
  );
}
