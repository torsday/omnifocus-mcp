/**
 * `project_template_save` MCP tool — capture a project as a reusable template.
 *
 * Captures the source project's task tree as TaskPaper (via the existing
 * export service) and writes it to a new project under the configured
 * Templates folder (env `OMNIFOCUS_TEMPLATES_FOLDER_NAME`, default
 * `Templates`). Metadata (template name, parameter names, capturedAt) lives
 * in a fenced YAML block at the top of the new project's note; the captured
 * TaskPaper sits below the fence.
 *
 * Out of scope this cycle (filed as follow-ups): instantiation with
 * parameter substitution + relative-date shifting, and template deletion.
 *
 * @see #472 — feature spec
 * @see src/domain/projectTemplates.ts — fence shape and parser
 * @see src/services/exportService.ts — TaskPaper export
 * @see src/tools/project/templateList.ts — sibling read tool
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateProjectMutation } from "../../cache/invalidation.js";
import type { FolderId } from "../../domain/ids.js";
import { ProjectId } from "../../domain/ids.js";
import {
  buildProjectTemplateNote,
  type ProjectTemplateMeta,
} from "../../domain/projectTemplates.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { renderTaskPaper } from "../../services/export/taskpaper.js";
import { fetchProjectTaskTree, partitionTasksByParent } from "../../services/export/tree.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PROJECT_TEMPLATE_SAVE_DESCRIPTION =
  "Capture a project as a reusable template under the Templates folder " +
  "(env OMNIFOCUS_TEMPLATES_FOLDER_NAME). Metadata is stored in a fenced YAML " +
  "block at the top of the template-project note; TaskPaper body sits below. " +
  "Do NOT use to duplicate a one-off project — prefer task_duplicate. " +
  "Returns { templateId, templateName, capturedAt }. " +
  "Side effects: writes folder + project; sets meta.syncPending = true. " +
  'Example: { projectId: "p_001", templateName: "Client onboarding", parameterNames: ["client"] }.';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const projectTemplateSaveInputSchema = z.object({
  projectId: ProjectId.schema.describe("Source project to capture."),
  templateName: z
    .string()
    .min(1)
    .describe("Display name; must be unique within the Templates folder."),
  parameterNames: z
    .array(z.string().min(1))
    .optional()
    .describe("Optional placeholder names for future _instantiate substitution."),
});

export type ProjectTemplateSaveToolInput = z.infer<typeof projectTemplateSaveInputSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TemplateExistsError extends Error {
  readonly code = "TEMPLATE_EXISTS";
  constructor(name: string) {
    super(`A template named "${name}" already exists in the Templates folder.`);
    this.name = "TemplateExistsError";
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ProjectTemplateSaveContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
  /** Folder name used to hold templates. Resolved from `OMNIFOCUS_TEMPLATES_FOLDER_NAME`. */
  templatesFolderName: string;
}

// ---------------------------------------------------------------------------
// Folder resolution
// ---------------------------------------------------------------------------

/**
 * Find the Templates folder by name (case-insensitive on the leaf), creating
 * it at the library root if absent. Mirrors the lazy-create-by-name pattern
 * used elsewhere (e.g. `task_set_waiting_on` for the @waiting tag).
 */
async function resolveOrCreateTemplatesFolder(
  adapter: OmniFocusAdapter,
  name: string,
): Promise<FolderId> {
  const all = await adapter.listFolders();
  const key = name.toLowerCase();
  const existing = all.find((f) => f.name.toLowerCase() === key);
  if (existing !== undefined) return existing.id;
  return adapter.createFolder({ name });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Pure handler for `project_template_save`.
 *
 * @throws {NotFound} when the source project ID does not exist
 * @throws {TemplateExistsError} when a template with `templateName` already exists
 *   in the Templates folder
 */
export async function handleProjectTemplateSave(
  input: ProjectTemplateSaveToolInput,
  ctx: ProjectTemplateSaveContext,
) {
  // Validate source exists (throws NotFound otherwise — propagates).
  await ctx.adapter.getProject(input.projectId);

  const folderId = await resolveOrCreateTemplatesFolder(ctx.adapter, ctx.templatesFolderName);

  // Reject duplicates by name within the Templates folder. Match on the leaf
  // project name only — different folders may legitimately reuse names.
  const existingProjects = await ctx.adapter.listProjects({ folderId });
  const nameKey = input.templateName.toLowerCase();
  if (existingProjects.some((p) => p.name.toLowerCase() === nameKey)) {
    throw new TemplateExistsError(input.templateName);
  }

  // Render the source as TaskPaper. Call the underlying renderer directly to
  // keep this tool's bundle dependency minimal — going through ExportService
  // would pull in OPML and import paths the template-save flow doesn't need.
  const sourceProject = await ctx.adapter.getProject(input.projectId);
  const tasks = await fetchProjectTaskTree(ctx.adapter, input.projectId);
  const { rootTasks, byParent } = partitionTasksByParent(tasks);
  const renderWarnings: string[] = [];
  const lines: string[] = [`${sourceProject.name}:`];
  if (sourceProject.note) {
    for (const noteLine of sourceProject.note.split("\n")) {
      lines.push(`\t${noteLine}`);
    }
  }
  for (const task of rootTasks) {
    renderTaskPaper(task, byParent, 1, lines, renderWarnings);
  }
  const taskPaperBody = lines.join("\n");

  const meta: ProjectTemplateMeta = {
    name: input.templateName,
    parameterNames: input.parameterNames ?? [],
    capturedAt: new Date().toISOString(),
  };
  const note = buildProjectTemplateNote(meta, taskPaperBody);

  const templateId = await ctx.adapter.createProject({
    name: input.templateName,
    folderId,
    note,
  });

  if (ctx.cache !== undefined) {
    invalidateProjectMutation(ctx.cache, { projectId: templateId });
  }

  return ok(
    {
      templateId,
      templateName: input.templateName,
      capturedAt: meta.capturedAt,
      ...(renderWarnings.length > 0 && { exportWarnings: renderWarnings }),
    },
    ctx.makeMeta({ syncPending: true }),
  );
}

export function registerProjectTemplateSaveTool(
  server: McpServer,
  ctx: ProjectTemplateSaveContext,
) {
  return server.registerTool(
    "project_template_save",
    {
      description: PROJECT_TEMPLATE_SAVE_DESCRIPTION,
      inputSchema: projectTemplateSaveInputSchema.shape,
    },
    async (args: ProjectTemplateSaveToolInput) => {
      const envelope = await handleProjectTemplateSave(args, ctx);
      return toolResponse(envelope);
    },
  );
}
