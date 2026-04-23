/**
 * `note_set_html` MCP tool — replace the HTML fragment note on a task or project.
 *
 * Accepts an HTML fragment and writes it as the note for the specified item.
 * OmniFocus preserves its supported HTML subset (bold, italic, links, lists,
 * inline images). Unsupported elements may be stripped silently by OmniFocus.
 *
 * To clear the note, pass `noteHtml: null`.
 * For plain-text writes, use `note_set` instead.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/tools/note/get_html.ts — read the HTML note
 * @see src/tools/note/set.ts — plain-text variant
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const NOTE_SET_HTML_DESCRIPTION =
  "Replace the HTML fragment note on a task or project. " +
  "Overwrites the existing note entirely with the provided HTML. " +
  "OmniFocus preserves its supported HTML subset (bold, italic, links, lists, inline images); " +
  "unsupported elements may be stripped. Pass noteHtml: null to clear the note. " +
  "For plain-text writes use note_set instead. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need the change to appear on other devices.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const noteSetHtmlInputSchema = z.object({
  targetKind: z
    .enum(["task", "project"])
    .describe("The kind of OmniFocus item whose HTML note to set."),
  id: z
    .string()
    .min(1)
    .describe(
      "Persistent ID of the task or project. " +
        "Get task IDs from task_list; project IDs from project_list.",
    ),
  noteHtml: z
    .string()
    .nullable()
    .describe("HTML fragment to set as the note. Pass null to clear the note entirely."),
});

export type NoteSetHtmlToolInput = z.infer<typeof noteSetHtmlInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface NoteSetHtmlContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `note_set_html`.
 *
 * Replaces the HTML note on the specified task or project.
 *
 * @throws {NotFound} when the task or project ID does not exist
 */
export async function handleNoteSetHtml(input: NoteSetHtmlToolInput, ctx: NoteSetHtmlContext) {
  if (input.targetKind === "task") {
    await ctx.adapter.updateTask(TaskId.of(input.id), { noteHtml: input.noteHtml });
  } else {
    await ctx.adapter.updateProject(ProjectId.of(input.id), { noteHtml: input.noteHtml });
  }
  return ok({ updated: true as const, id: input.id }, ctx.makeMeta({ syncPending: true }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerNoteSetHtmlTool(server: McpServer, ctx: NoteSetHtmlContext) {
  return server.registerTool(
    "note_set_html",
    { description: NOTE_SET_HTML_DESCRIPTION, inputSchema: noteSetHtmlInputSchema.shape },
    async (args: NoteSetHtmlToolInput) => {
      const envelope = await handleNoteSetHtml(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
