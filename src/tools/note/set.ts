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
import {
  type InvalidatingCache,
  invalidateProjectMutation,
  invalidateTaskMutation,
} from "../../cache/invalidation.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import { NOTE_MAX_CHARS } from "../../domain/inputLimits.js";
import { summaryNoteSet } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const NOTE_SET_DESCRIPTION =
  "Replace the plain-text note on a task or project. " +
  "Overwrites the existing note entirely. Pass note: null to clear the note. " +
  "To add text without overwriting use note_append instead. " +
  "Returns { updated: true, id, targetKind, name, note } — name is the parent task/project's display name (pre-fetched so the response describes the change without a follow-up read); note echoes back the final content after writing (or null if cleared). " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need the change to appear on other devices. " +
  'Example: note_set({ targetKind: "task", id: "abc123", note: "Check with Alice first" })';

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
  note: z
    .string()
    .max(NOTE_MAX_CHARS, "max 1 MB")
    .nullable()
    .describe("New note text. Pass null to clear the note entirely."),
});

export type NoteSetToolInput = z.infer<typeof noteSetInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface NoteSetContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /** Optional cache; when supplied, flushes stale task/project entries after write. */
  cache?: InvalidatingCache;
}

/**
 * Pure handler for `note_set`.
 *
 * Replaces the note on the specified task or project, then invalidates the
 * relevant cache scopes so subsequent reads reflect the new note content.
 *
 * @throws {NotFound} when the task or project ID does not exist
 */
export async function handleNoteSet(input: NoteSetToolInput, ctx: NoteSetContext) {
  // Pre-fetch the parent's display name so the response can describe the
  // change without a follow-up read (lever-4 round-trip readability, #606).
  const name =
    input.targetKind === "task"
      ? (await ctx.adapter.getTask(TaskId.of(input.id))).name
      : (await ctx.adapter.getProject(ProjectId.of(input.id))).name;

  if (input.targetKind === "task") {
    await ctx.adapter.updateTask(TaskId.of(input.id), { note: input.note });
    if (ctx.cache !== undefined) {
      invalidateTaskMutation(ctx.cache, { taskId: TaskId.of(input.id) });
    }
  } else {
    await ctx.adapter.updateProject(ProjectId.of(input.id), { note: input.note });
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
      note: input.note,
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

export function registerNoteSetTool(server: McpServer, ctx: NoteSetContext) {
  return server.registerTool(
    "note_set",
    { description: NOTE_SET_DESCRIPTION, inputSchema: noteSetInputSchema.shape },
    async (args: NoteSetToolInput) => {
      const envelope = await handleNoteSet(args, ctx);
      return toolResponse(envelope);
    },
  );
}
