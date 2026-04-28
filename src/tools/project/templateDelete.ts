/**
 * `project_template_delete` MCP tool — remove a saved project template by name.
 *
 * Completes the template CRUD surface started by `project_template_save` and
 * `project_template_list`. Locates the named template under the configured
 * Templates folder (case-insensitive), deletes it, and returns
 * `{ deleted: true, templateName }`. A missing template is always a typed
 * `TemplateNotFoundError` — the caller should know whether their delete
 * actually removed something.
 *
 * @see #588 — feature spec
 * @see src/tools/project/templateSave.ts — sibling write tool
 * @see src/tools/project/templateList.ts — sibling read tool
 * @see src/domain/projectTemplates.ts — fence parser
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateProjectMutation } from "../../cache/invalidation.js";
import { parseProjectTemplateMeta } from "../../domain/projectTemplates.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { NotFound } from "../../errors/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PROJECT_TEMPLATE_DELETE_DESCRIPTION =
  "Delete a saved project template by name from the Templates folder. " +
  "Returns { deleted: true, templateName } on success. " +
  "Returns TemplateNotFoundError when no matching template exists — " +
  "callers can distinguish 'deleted' from 'never existed'. " +
  "Side effects: removes the template project; sets meta.syncPending = true. " +
  "Do NOT use to delete ordinary projects — call project_delete. " +
  'Example: { templateName: "Client onboarding" }.';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const projectTemplateDeleteInputSchema = z.object({
  templateName: z
    .string()
    .min(1)
    .describe(
      "Name of the template to delete. Matched case-insensitively within the Templates folder.",
    ),
});

export type ProjectTemplateDeleteToolInput = z.infer<typeof projectTemplateDeleteInputSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TemplateNotFoundError extends NotFound {
  constructor(name: string) {
    super(`No template named "${name}" was found in the Templates folder.`, {
      details: { templateName: name },
    });
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ProjectTemplateDeleteContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
  /** Folder name used to hold templates. Resolved from `OMNIFOCUS_TEMPLATES_FOLDER_NAME`. */
  templatesFolderName: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleProjectTemplateDelete(
  input: ProjectTemplateDeleteToolInput,
  ctx: ProjectTemplateDeleteContext,
) {
  const folders = await ctx.adapter.listFolders();
  const key = ctx.templatesFolderName.toLowerCase();
  const templatesFolder = folders.find((f) => f.name.toLowerCase() === key);

  if (templatesFolder === undefined) {
    throw new TemplateNotFoundError(input.templateName);
  }

  const projects = await ctx.adapter.listProjects({ folderId: templatesFolder.id });
  const nameKey = input.templateName.toLowerCase();
  const match = projects.find((p) => {
    if (p.name.toLowerCase() !== nameKey) return false;
    return parseProjectTemplateMeta(p.note) !== undefined;
  });

  if (match === undefined) {
    throw new TemplateNotFoundError(input.templateName);
  }

  await ctx.adapter.deleteProject(match.id);

  if (ctx.cache !== undefined) {
    invalidateProjectMutation(ctx.cache, { projectId: match.id });
  }

  return ok(
    { deleted: true as const, templateName: input.templateName },
    ctx.makeMeta({ syncPending: true }),
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProjectTemplateDeleteTool(
  server: McpServer,
  ctx: ProjectTemplateDeleteContext,
) {
  return server.registerTool(
    "project_template_delete",
    {
      description: PROJECT_TEMPLATE_DELETE_DESCRIPTION,
      inputSchema: projectTemplateDeleteInputSchema.shape,
    },
    async (args: ProjectTemplateDeleteToolInput) => {
      const envelope = await handleProjectTemplateDelete(args, ctx);
      return toolResponse(envelope);
    },
  );
}
