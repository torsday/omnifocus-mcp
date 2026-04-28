/**
 * `project_template_list` MCP tool — enumerate saved project templates.
 *
 * Lists every project under the configured Templates folder (env
 * `OMNIFOCUS_TEMPLATES_FOLDER_NAME`, default `Templates`) and surfaces the
 * fenced metadata (template name, parameter names, capturedAt) parsed from
 * each project's note. Projects without a `project-template` fence are
 * silently skipped — the user might keep ordinary projects there for
 * organization, and "no fence" cleanly means "not really a template."
 *
 * Returns an empty list (not an error) when the Templates folder doesn't
 * exist yet — first-time users haven't run `project_template_save` and the
 * tool surface should reflect "no templates," not "feature broken."
 *
 * @see #472 — feature spec
 * @see src/tools/project/templateSave.ts — sibling write tool
 * @see src/domain/projectTemplates.ts — fence parser
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import type { ProjectId } from "../../domain/ids.js";
import { parseProjectTemplateMeta } from "../../domain/projectTemplates.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PROJECT_TEMPLATE_LIST_DESCRIPTION =
  "List saved project templates under the Templates folder. " +
  "Projects without a parseable template fence are skipped. " +
  "Do NOT use to enumerate ordinary projects — call project_list. " +
  "Returns { templates: [{ templateId, templateName, parameterNames, capturedAt }] }, " +
  "sorted by capturedAt desc. Read-only; safe to retry. " +
  "Example: call with no args; receives [] when no Templates folder exists yet.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const projectTemplateListInputSchema = z.object({});

export type ProjectTemplateListToolInput = z.infer<typeof projectTemplateListInputSchema>;

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export interface ProjectTemplateListEntry {
  templateId: ProjectId;
  templateName: string;
  parameterNames: string[];
  capturedAt: string;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ProjectTemplateListContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /** Folder name used to hold templates. Resolved from `OMNIFOCUS_TEMPLATES_FOLDER_NAME`. */
  templatesFolderName: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Pure handler for `project_template_list`. Read-only.
 */
export async function handleProjectTemplateList(
  _input: ProjectTemplateListToolInput,
  ctx: ProjectTemplateListContext,
) {
  const folders = await ctx.adapter.listFolders();
  const key = ctx.templatesFolderName.toLowerCase();
  const templatesFolder = folders.find((f) => f.name.toLowerCase() === key);
  if (templatesFolder === undefined) {
    return ok({ templates: [] as ProjectTemplateListEntry[] }, ctx.makeMeta());
  }

  const projects = await ctx.adapter.listProjects({ folderId: templatesFolder.id });
  const entries: ProjectTemplateListEntry[] = [];
  for (const project of projects) {
    const meta = parseProjectTemplateMeta(project.note);
    if (meta === undefined) continue;
    entries.push({
      templateId: project.id,
      templateName: meta.name,
      parameterNames: meta.parameterNames,
      capturedAt: meta.capturedAt,
    });
  }

  // Most-recent first; tie-break on name for deterministic ordering.
  entries.sort((a, b) => {
    if (a.capturedAt !== b.capturedAt) {
      return a.capturedAt < b.capturedAt ? 1 : -1;
    }
    return a.templateName < b.templateName ? -1 : a.templateName > b.templateName ? 1 : 0;
  });

  return ok({ templates: entries }, ctx.makeMeta());
}

export function registerProjectTemplateListTool(
  server: McpServer,
  ctx: ProjectTemplateListContext,
) {
  return server.registerTool(
    "project_template_list",
    {
      description: PROJECT_TEMPLATE_LIST_DESCRIPTION,
      inputSchema: projectTemplateListInputSchema.shape,
    },
    async (args: ProjectTemplateListToolInput) => {
      const envelope = await handleProjectTemplateList(args, ctx);
      return toolResponse(envelope);
    },
  );
}
