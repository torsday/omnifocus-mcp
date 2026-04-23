/**
 * `note_get_html` MCP tool — read the HTML fragment from a task or project note.
 *
 * OmniFocus stores notes as rich text internally. This tool returns the HTML
 * fragment representation for full formatting fidelity (bold, links, lists,
 * inline images). For plain-text access use `note_get`.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/tools/note/get.ts — plain-text variant
 * @see src/tools/note/set_html.ts — write the HTML note
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const NOTE_GET_HTML_DESCRIPTION =
  "Read the HTML fragment from a task or project note. " +
  "Returns { noteHtml } — an HTML string (may be empty) or null when no note exists. " +
  "Set targetKind to 'task' and provide a task ID, or 'project' and a project ID. " +
  "For plain-text access without formatting, use note_get instead. " +
  "Safe to call repeatedly; no side effects.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const noteGetHtmlInputSchema = z.object({
  targetKind: z
    .enum(["task", "project"])
    .describe("The kind of OmniFocus item whose HTML note to read."),
  id: z
    .string()
    .min(1)
    .describe(
      "Persistent ID of the task or project. " +
        "Get task IDs from task_list; project IDs from project_list.",
    ),
});

export type NoteGetHtmlToolInput = z.infer<typeof noteGetHtmlInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface NoteGetHtmlContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `note_get_html`.
 *
 * Reads the HTML fragment from the specified task or project note.
 * Returns `null` when the item has no note.
 *
 * @throws {NotFound} when the task or project ID does not exist
 */
export async function handleNoteGetHtml(input: NoteGetHtmlToolInput, ctx: NoteGetHtmlContext) {
  const noteHtml =
    input.targetKind === "task"
      ? (await ctx.adapter.getTask(TaskId.of(input.id))).noteHtml
      : (await ctx.adapter.getProject(ProjectId.of(input.id))).noteHtml;

  return ok({ noteHtml: noteHtml ?? null }, ctx.makeMeta());
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerNoteGetHtmlTool(server: McpServer, ctx: NoteGetHtmlContext) {
  return server.registerTool(
    "note_get_html",
    { description: NOTE_GET_HTML_DESCRIPTION, inputSchema: noteGetHtmlInputSchema.shape },
    async (args: NoteGetHtmlToolInput) => {
      const envelope = await handleNoteGetHtml(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
