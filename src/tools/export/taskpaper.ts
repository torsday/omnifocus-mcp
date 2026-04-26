/**
 * `export_taskpaper` and `import_taskpaper` MCP tools.
 *
 * `export_taskpaper` serialises a project, folder, or all active projects to
 * TaskPaper format — a plain-text outliner format native to the Mac app
 * TaskPaper and natively importable into OmniFocus. Export is lossy (see
 * warnings in the response).
 *
 * `import_taskpaper` parses TaskPaper text and creates tasks via the adapter.
 * Project headings (`Name:`) are matched to existing OF projects by name.
 * Unknown tags are created on the fly.
 *
 * @see src/services/exportService.ts — serialisation logic
 * @see DESIGN.md §12 — response envelope
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FolderId, ProjectId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";
import type { ExportScope, ExportService } from "../../services/exportService.js";

// ---------------------------------------------------------------------------
// Tool descriptions
// ---------------------------------------------------------------------------

export const EXPORT_TASKPAPER_DESCRIPTION =
  "Export OmniFocus data as TaskPaper plain text. " +
  "Three scopes: 'project' (one project + its tasks), 'folder' (all projects in a folder), " +
  "or 'all' (all active projects). " +
  "Export is lossy — HTML notes are downgraded to plain text; tag locations, " +
  "attachments, and complex repetition rules are omitted. " +
  "Lossiness warnings are returned in meta.warnings. " +
  "Do NOT use to import data; prefer import_taskpaper for that. " +
  "Returns { taskpaper, projectCount, taskCount }. " +
  "Safe to call repeatedly; no side effects.";

export const IMPORT_TASKPAPER_DESCRIPTION =
  "Import tasks from TaskPaper text into OmniFocus. " +
  "Parses '- Task name @tag @due(2026-01-15) @defer(2026-01-10) @flagged' lines. " +
  "Indented subtasks become children of the nearest parent task. " +
  "Project headings ('Project name:') map to existing OF projects by name — " +
  "unrecognised headings fall back to inbox (warning emitted). " +
  "Unknown @tags are created automatically. " +
  "Do NOT use to export data; prefer export_taskpaper for that. " +
  "Returns { created: TaskId[], warnings: string[] }. " +
  "Writes to OmniFocus; call sync_trigger to propagate changes to other devices.";

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

export const exportTaskPaperInputSchema = z.object({
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

export type ExportTaskPaperToolInput = z.infer<typeof exportTaskPaperInputSchema>;

export const importTaskPaperInputSchema = z.object({
  text: z
    .string()
    .min(1)
    .describe("TaskPaper-formatted text to import. Each '- Task name' line becomes a task."),
  targetProjectId: z
    .string()
    .optional()
    .describe(
      "When set, all top-level tasks are created in this project regardless of project headings in the text. Get the ID from project_list.",
    ),
});

export type ImportTaskPaperToolInput = z.infer<typeof importTaskPaperInputSchema>;

// ---------------------------------------------------------------------------
// Context / handler
// ---------------------------------------------------------------------------

export interface TaskPaperToolContext {
  exportService: ExportService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Resolve export input into a typed `ExportScope`, validating that `id` is
 * present when required.
 */
function resolveScope(input: ExportTaskPaperToolInput): ExportScope {
  if (input.scope === "all") return { kind: "all" };
  if (!input.id) {
    throw new ValidationError(
      `scope="${input.scope}" requires an id — provide the ${input.scope === "project" ? "project" : "folder"} ID`,
      { details: { field: "id", scope: input.scope } },
    );
  }
  if (input.scope === "project") return { kind: "project", id: ProjectId.of(input.id) };
  return { kind: "folder", id: FolderId.of(input.id) };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register `export_taskpaper` and `import_taskpaper` tools with the server.
 */
export function registerTaskPaperTools(server: McpServer, ctx: TaskPaperToolContext): void {
  // ── export_taskpaper ──────────────────────────────────────────────────────
  server.registerTool(
    "export_taskpaper",
    {
      description: EXPORT_TASKPAPER_DESCRIPTION,
      inputSchema: exportTaskPaperInputSchema.shape,
    },
    async (input: ExportTaskPaperToolInput) => {
      const scope = resolveScope(input);
      const result = await ctx.exportService.exportTaskPaper(scope);
      return toolResponse(
        ok(
          {
            taskpaper: result.taskpaper,
            projectCount: result.projectCount,
            taskCount: result.taskCount,
            warnings: result.warnings,
          },
          ctx.makeMeta(),
        ),
      );
    },
  );

  // ── import_taskpaper ──────────────────────────────────────────────────────
  server.registerTool(
    "import_taskpaper",
    {
      description: IMPORT_TASKPAPER_DESCRIPTION,
      inputSchema: importTaskPaperInputSchema.shape,
    },
    async (input: ImportTaskPaperToolInput) => {
      const result = await ctx.exportService.importTaskPaper(
        input.text,
        input.targetProjectId === undefined ? undefined : ProjectId.of(input.targetProjectId),
      );
      return toolResponse(
        ok({ created: result.created, warnings: result.warnings }, ctx.makeMeta()),
      );
    },
  );
}
