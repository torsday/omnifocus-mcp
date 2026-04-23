/**
 * `note_append` MCP tool — append text to the plain-text note on a task or project.
 *
 * Reads the current note then writes the combined result in a single handler
 * call. The read+write is not atomic at the OmniFocus database level, but
 * the server's write-queue serialization (ADR-0009) ensures no concurrent
 * mutation interleaves between the read and write within this server process.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/tools/note/get.ts — read the note
 * @see src/tools/note/set.ts — replace the note
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const NOTE_APPEND_DESCRIPTION =
  "Append text to the plain-text note on a task or project. " +
  "Adds a newline between existing content and the new text unless the note is empty. " +
  "Do not use to replace the note entirely; prefer note_set instead. " +
  "Returns { note } with the full note content after appending. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need the change to appear on other devices.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const noteAppendInputSchema = z.object({
  targetKind: z
    .enum(["task", "project"])
    .describe("The kind of OmniFocus item whose note to append to."),
  id: z
    .string()
    .min(1)
    .describe(
      "Persistent ID of the task or project. " +
        "Get task IDs from task_list; project IDs from project_list.",
    ),
  text: z
    .string()
    .min(1)
    .describe("Text to append. A newline separator is inserted before the text if a note exists."),
});

export type NoteAppendToolInput = z.infer<typeof noteAppendInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface NoteAppendContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `note_append`.
 *
 * Reads the current note, appends `text` with a newline separator (when
 * the existing note is non-empty), then writes the result back.
 *
 * @throws {NotFound} when the task or project ID does not exist
 */
export async function handleNoteAppend(input: NoteAppendToolInput, ctx: NoteAppendContext) {
  const existing =
    input.targetKind === "task"
      ? (await ctx.adapter.getTask(TaskId.of(input.id))).note
      : (await ctx.adapter.getProject(ProjectId.of(input.id))).note;

  const combined = existing ? `${existing}\n${input.text}` : input.text;

  if (input.targetKind === "task") {
    await ctx.adapter.updateTask(TaskId.of(input.id), { note: combined });
  } else {
    await ctx.adapter.updateProject(ProjectId.of(input.id), { note: combined });
  }

  return ok({ updated: true as const, id: input.id }, ctx.makeMeta({ syncPending: true }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerNoteAppendTool(server: McpServer, ctx: NoteAppendContext) {
  return server.registerTool(
    "note_append",
    { description: NOTE_APPEND_DESCRIPTION, inputSchema: noteAppendInputSchema.shape },
    async (args: NoteAppendToolInput) => {
      const envelope = await handleNoteAppend(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
