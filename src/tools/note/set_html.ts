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
import {
  type InvalidatingCache,
  invalidateProjectMutation,
  invalidateTaskMutation,
} from "../../cache/invalidation.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import { summaryNoteSet } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const NOTE_SET_HTML_DESCRIPTION =
  "Replace the HTML fragment note on a task or project. " +
  "Overwrites the existing note entirely with the provided HTML. " +
  "OmniFocus preserves its supported HTML subset (bold, italic, links, lists, inline images); " +
  "unsupported elements may be stripped. Pass noteHtml: null to clear the note. " +
  "For plain-text writes use note_set instead. " +
  "Returns { updated: true, id, targetKind, name, noteHtml } — name is the parent task/project's display name (pre-fetched so the response describes the change without a follow-up read); noteHtml echoes back the requested HTML (or null if cleared). " +
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
  /** Optional cache; when supplied, flushes stale task/project entries after write. */
  cache?: InvalidatingCache;
}

/**
 * Pure handler for `note_set_html`.
 *
 * Replaces the HTML note on the specified task or project, then invalidates
 * the relevant cache scopes so subsequent reads reflect the new note content.
 *
 * @throws {NotFound} when the task or project ID does not exist
 */
export async function handleNoteSetHtml(input: NoteSetHtmlToolInput, ctx: NoteSetHtmlContext) {
  // Pre-fetch the parent's display name (lever-4 pairing, #606).
  const name =
    input.targetKind === "task"
      ? (await ctx.adapter.getTask(TaskId.of(input.id))).name
      : (await ctx.adapter.getProject(ProjectId.of(input.id))).name;

  if (input.targetKind === "task") {
    await ctx.adapter.updateTask(TaskId.of(input.id), { noteHtml: input.noteHtml });
    if (ctx.cache !== undefined) {
      invalidateTaskMutation(ctx.cache, { taskId: TaskId.of(input.id) });
    }
  } else {
    await ctx.adapter.updateProject(ProjectId.of(input.id), { noteHtml: input.noteHtml });
    if (ctx.cache !== undefined) {
      invalidateProjectMutation(ctx.cache, { projectId: ProjectId.of(input.id) });
    }
  }
  return ok(
    {
      updated: true as const,
      id: input.id,
      targetKind: input.targetKind,
      name,
      noteHtml: input.noteHtml,
    },
    ctx.makeMeta({
      syncPending: true,
      humanReadableSummary: summaryNoteSet(input.targetKind, name),
    }),
  );
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
      return toolResponse(envelope);
    },
  );
}
