/**
 * `export_opml` MCP tool — export OmniFocus data as OPML XML.
 *
 * Supports three scopes: a single project, all projects in a folder, or
 * all active projects. Returns a complete OPML document following
 * OmniFocus conventions for round-trip import.
 *
 * @see src/services/exportService.ts
 * @see DESIGN.md §12 — response envelope
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FolderId, ProjectId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";
import type { ExportScope, ExportService } from "../../services/exportService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const EXPORT_OPML_DESCRIPTION =
  "Export OmniFocus data as OPML XML — a structured outline format OmniFocus can import. " +
  "Do NOT use to export a single task; OPML scope is project-level or broader. " +
  "Three scopes: 'project' (one project + its tasks), 'folder' (all projects in a folder), " +
  "or 'all' (all active projects). " +
  "Returns { opml, projectCount, taskCount } where opml is a complete XML string. " +
  "Safe to call repeatedly; no side effects. " +
  'Example: export_opml({ scope: "project", id: "abc123" }) ' +
  'Example: export_opml({ scope: "all" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const exportOpmlInputSchema = z.object({
  scope: z
    .enum(["project", "folder", "all"])
    .describe(
      "What to export: 'project' (one project), 'folder' (all projects in a folder), or 'all' (all active projects).",
    ),
  id: z
    .string()
    .optional()
    .describe(
      "Required when scope='project' (project ID from project_list) or scope='folder' (folder ID from folder_list). Omit for scope='all'.",
    ),
});

export type ExportOpmlToolInput = z.infer<typeof exportOpmlInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ExportOpmlContext {
  exportService: ExportService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Resolve the tool input into a typed `ExportScope`.
 *
 * @throws {ValidationError} when scope requires an id but none is supplied —
 *   the Zod schema accepts `id` as optional; the handler validates the combination.
 */
function resolveScope(input: ExportOpmlToolInput): ExportScope {
  if (input.scope === "all") {
    return { kind: "all" };
  }
  if (!input.id) {
    throw new ValidationError(`scope='${input.scope}' requires an id`, {
      details: { field: "id", scope: input.scope },
    });
  }
  if (input.scope === "project") {
    return { kind: "project", id: ProjectId.of(input.id) };
  }
  return { kind: "folder", id: FolderId.of(input.id) };
}

export async function handleExportOpml(input: ExportOpmlToolInput, ctx: ExportOpmlContext) {
  const scope = resolveScope(input);
  const result = await ctx.exportService.exportOpml(scope);
  const meta = ctx.makeMeta();
  return ok(
    {
      opml: result.opml,
      projectCount: result.projectCount,
      taskCount: result.taskCount,
    },
    meta,
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerExportOpmlTool(server: McpServer, ctx: ExportOpmlContext) {
  return server.registerTool(
    "export_opml",
    {
      description: EXPORT_OPML_DESCRIPTION,
      inputSchema: exportOpmlInputSchema.shape,
    },
    async (args: ExportOpmlToolInput) => {
      const envelope = await handleExportOpml(args, ctx);
      return toolResponse(envelope);
    },
  );
}
