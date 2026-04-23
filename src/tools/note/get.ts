/**
 * `note_get` MCP tool — read the plain-text note from a task or project.
 *
 * Notes in OmniFocus are stored as rich text internally; this tool returns
 * the plain-text rendering. For HTML fidelity see `note_get_html` (M3, #63).
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/tools/note/set.ts — write the note
 * @see src/tools/note/append.ts — append to the note
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const NOTE_GET_DESCRIPTION =
  "Read the plain-text note from a task or project. " +
  "Returns { note } — a string (may be empty) or null when no note exists. " +
  "Set targetKind to 'task' and provide a task ID, or 'project' and a project ID. " +
  "For the full HTML representation with formatting, use note_get_html.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const noteGetInputSchema = z.object({
  targetKind: z
    .enum(["task", "project"])
    .describe("The kind of OmniFocus item whose note to read."),
  id: z
    .string()
    .min(1)
    .describe(
      "Persistent ID of the task or project. " +
        "Get task IDs from task_list; project IDs from project_list.",
    ),
});

export type NoteGetToolInput = z.infer<typeof noteGetInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface NoteGetContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `note_get`.
 *
 * Reads the plain-text note from the specified task or project.
 * Returns `null` when the item has no note.
 *
 * @throws {NotFound} when the task or project ID does not exist
 */
export async function handleNoteGet(input: NoteGetToolInput, ctx: NoteGetContext) {
  const note =
    input.targetKind === "task"
      ? (await ctx.adapter.getTask(TaskId.of(input.id))).note
      : (await ctx.adapter.getProject(ProjectId.of(input.id))).note;

  return ok({ note: note ?? null }, ctx.makeMeta());
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerNoteGetTool(server: McpServer, ctx: NoteGetContext) {
  return server.registerTool(
    "note_get",
    { description: NOTE_GET_DESCRIPTION, inputSchema: noteGetInputSchema.shape },
    async (args: NoteGetToolInput) => {
      const envelope = await handleNoteGet(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
