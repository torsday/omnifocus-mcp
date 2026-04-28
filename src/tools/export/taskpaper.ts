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
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
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
  "Safe to call repeatedly; no side effects. " +
  'Example: export_taskpaper({ scope: "project", id: "abc123" }) ' +
  'Example: export_taskpaper({ scope: "all" })';

export const IMPORT_TASKPAPER_DESCRIPTION =
  "Import tasks from TaskPaper text into OmniFocus. " +
  "Parses '- Task name @tag @due(2026-01-15) @defer(2026-01-10) @flagged' lines. " +
  "Indented subtasks become children of the nearest parent task. " +
  "Project headings ('Project name:') map to existing OF projects by name — " +
  "unrecognised headings fall back to inbox (warning emitted). " +
  "Unknown @tags are created automatically. " +
  "Do NOT use to export data; prefer export_taskpaper for that. " +
  "Returns { tasks: [{ id, name }], warnings: string[] } — tasks pairs each new id with its display name (resolved via a single getTasksMany batch, no N+1) so the agent can confirm what landed without a follow-up read. Orphan ids (rare; deleted between import and lookup) are dropped from the array. " +
  "Writes to OmniFocus; call sync_trigger to propagate changes to other devices. " +
  'Example: import_taskpaper({ text: "- Buy milk @errands\\n- Call dentist @due(2026-05-01)" })';

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
  /** Adapter is needed for the post-import getTasksMany batch that powers the lever-4 name pairing (#609). */
  adapter: OmniFocusAdapter;
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
    async (input: ImportTaskPaperToolInput) =>
      toolResponse(await handleImportTaskPaper(input, ctx)),
  );
}

/**
 * Pure handler for `import_taskpaper` — exposed for direct unit tests so the
 * lever-4 name pairing (#609) can be exercised without the MCP register layer.
 */
export async function handleImportTaskPaper(
  input: ImportTaskPaperToolInput,
  ctx: TaskPaperToolContext,
) {
  const result = await ctx.exportService.importTaskPaper(
    input.text,
    input.targetProjectId === undefined ? undefined : ProjectId.of(input.targetProjectId),
  );
  // Single batch lookup pairs each created id with its name; orphans
  // (deleted between import and lookup) are dropped (#609).
  const fetched = result.created.length > 0 ? await ctx.adapter.getTasksMany(result.created) : [];
  const tasks = result.created
    .map((id, i) => {
      const task = fetched[i];
      return task === null || task === undefined ? null : { id: String(id), name: task.name };
    })
    .filter((row): row is { id: string; name: string } => row !== null);
  return ok({ tasks, warnings: result.warnings }, ctx.makeMeta());
}
