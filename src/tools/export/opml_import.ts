/**
 * `import_opml` MCP tool — import tasks from an OPML XML string.
 *
 * Parses the OPML produced by `export_opml` and recreates the task/project
 * hierarchy in OmniFocus via the adapter. This tool completes the OPML
 * round-trip (export → import).
 *
 * **Lossiness:** OPML preserves outline text and nesting only. Due/defer
 * dates and flagged state are retained on round-trip. Tags, notes,
 * attachments, repetition rules, and other metadata are silently dropped
 * because standard OPML has no encoding for them.
 *
 * @see src/tools/export/opml.ts — export counterpart
 * @see src/services/exportService.ts — parsing and creation logic
 * @see DESIGN.md §12 — response envelope
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ProjectId } from "../../domain/ids.js";
import { summaryBatchCreate } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ExportService } from "../../services/exportService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const IMPORT_OPML_DESCRIPTION =
  "Import tasks from an OPML XML string into OmniFocus. " +
  "Parses the OPML produced by export_opml and recreates the task hierarchy. " +
  'Top-level <outline type="omnifocus:project"> elements are matched to existing ' +
  "projects by OmniFocus ID (for round-trip) then by name; unmatched project outlines " +
  "land in the Inbox. " +
  "LOSSY: due dates, defer dates, and flagged state are preserved; tags, notes, " +
  "attachments, and repetition rules are silently dropped (not encoded in OPML). " +
  "Do NOT use to export data; prefer export_opml for that. " +
  "Returns { imported, taskIds } where imported is the count of tasks created. " +
  "Writes to OmniFocus; call sync_trigger after import to propagate changes to other devices. " +
  'Example: import_opml({ opml: "<opml>...</opml>" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const importOpmlInputSchema = z.object({
  opml: z
    .string()
    .min(1)
    .describe(
      "Well-formed OPML XML string to import. Use the output of export_opml for a round-trip.",
    ),
  destinationProjectId: z
    .string()
    .optional()
    .describe(
      "When set, all tasks are created in this project regardless of project headings in the OPML. " +
        "Get the ID from project_list. Omit to match projects by ID/name from the OPML structure.",
    ),
});

export type ImportOpmlToolInput = z.infer<typeof importOpmlInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ImportOpmlContext {
  exportService: ExportService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleImportOpml(input: ImportOpmlToolInput, ctx: ImportOpmlContext) {
  const result = await ctx.exportService.importOpml(input.opml, {
    ...(input.destinationProjectId !== undefined
      ? { destinationProjectId: ProjectId.of(input.destinationProjectId) }
      : {}),
  });

  const meta = ctx.makeMeta({
    syncPending: true,
    humanReadableSummary: summaryBatchCreate(result.imported),
  });
  return ok(
    {
      imported: result.imported,
      taskIds: result.taskIds.map(String),
    },
    meta,
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerImportOpmlTool(server: McpServer, ctx: ImportOpmlContext) {
  return server.registerTool(
    "import_opml",
    {
      description: IMPORT_OPML_DESCRIPTION,
      inputSchema: importOpmlInputSchema.shape,
    },
    async (args: ImportOpmlToolInput) => {
      const envelope = await handleImportOpml(args, ctx);
      return toolResponse(envelope);
    },
  );
}
