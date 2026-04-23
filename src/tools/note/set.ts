/**
 * `note_set` MCP tool — replace the plain-text note on a task or project.
 *
 * Replaces the full note. To append without overwriting existing content,
 * use `note_append` instead. To clear the note, pass `note: null`.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/tools/note/get.ts — read the note
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

export const NOTE_SET_DESCRIPTION =
  "Replace the plain-text note on a task or project. " +
  "Overwrites the existing note entirely. Pass note: null to clear the note. " +
  "To add text without overwriting use note_append instead. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need the change to appear on other devices.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const noteSetInputSchema = z.object({
  targetKind: z.enum(["task", "project"]).describe("The kind of OmniFocus item whose note to set."),
  id: z
    .string()
    .min(1)
    .describe(
      "Persistent ID of the task or project. " +
        "Get task IDs from task_list; project IDs from project_list.",
    ),
  note: z.string().nullable().describe("New note text. Pass null to clear the note entirely."),
});

export type NoteSetToolInput = z.infer<typeof noteSetInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface NoteSetContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `note_set`.
 *
 * Replaces the note on the specified task or project.
 *
 * @throws {NotFound} when the task or project ID does not exist
 */
export async function handleNoteSet(input: NoteSetToolInput, ctx: NoteSetContext) {
  if (input.targetKind === "task") {
    await ctx.adapter.updateTask(TaskId.of(input.id), { note: input.note });
  } else {
    await ctx.adapter.updateProject(ProjectId.of(input.id), { note: input.note });
  }
  return ok({ updated: true as const, id: input.id }, ctx.makeMeta({ syncPending: true }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerNoteSetTool(server: McpServer, ctx: NoteSetContext) {
  return server.registerTool(
    "note_set",
    { description: NOTE_SET_DESCRIPTION, inputSchema: noteSetInputSchema.shape },
    async (args: NoteSetToolInput) => {
      const envelope = await handleNoteSet(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
