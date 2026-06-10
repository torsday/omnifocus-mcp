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
import {
  type InvalidatingCache,
  invalidateProjectMutation,
  invalidateTaskMutation,
} from "../../cache/invalidation.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import { NOTE_MAX_CHARS } from "../../domain/inputLimits.js";
import { summaryNoteAppend } from "../../domain/writeSummary.js";
import {
  ok,
  type ResponseMeta,
  type ToolEnvelope,
  type ToolSuccess,
  toolResponse,
} from "../../envelope/index.js";
import {
  idempotencyStore as defaultIdempotencyStore,
  type IdempotencyStore,
  withIdempotencyKey,
} from "../../server/idempotencyStore.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const NOTE_APPEND_DESCRIPTION =
  "Append text to the plain-text note on a task or project. " +
  "Adds a newline between existing content and the new text unless the note is empty. " +
  "Do not use to replace the note entirely; prefer note_set instead. " +
  "Pass idempotency_key to coalesce retries — append is not naturally idempotent and replays without a key duplicate the text. " +
  "Returns { updated: true, id, targetKind, name, note } — name is the parent task/project's display name (captured from the same read that fetched the existing note) so the agent can describe the change without a follow-up read; note is the full content after appending. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need the change to appear on other devices. " +
  'Example: note_append({ targetKind: "task", id: "abc123", text: "Follow up next week" })';

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
    .max(NOTE_MAX_CHARS, "max 1 MB")
    .describe("Text to append. A newline separator is inserted before the text if a note exists."),
  idempotency_key: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe(
      "Idempotency key for retry-safe appends. `append` is not naturally " +
        "idempotent — replays without a key multiply the appended text. " +
        "Identical subsequent calls with the same key within the TTL window " +
        "replay the original envelope with meta.idempotentReplay = true " +
        "instead of appending again. See docs/idempotency.md.",
    ),
});

export type NoteAppendToolInput = z.infer<typeof noteAppendInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface NoteAppendContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /** Optional cache; when supplied, flushes stale task/project entries after write. */
  cache?: InvalidatingCache;
  /**
   * Optional idempotency store override (#981). Defaults to the module
   * singleton. Tests inject a scoped store so parallel specs don't share
   * keys. Append-shaped tool — replay protection is load-bearing here:
   * without a key, retries multiply the appended text.
   */
  idempotencyStore?: IdempotencyStore;
}

type NoteAppendData = {
  updated: true;
  id: string;
  targetKind: "task" | "project";
  name: string;
  note: string;
};

/**
 * Pure handler for `note_append`.
 *
 * Reads the current note, appends `text` with a newline separator (when
 * the existing note is non-empty), then writes the result back and
 * invalidates the relevant cache scopes.
 *
 * The whole flow is wrapped in `withIdempotencyKey` so retries with the
 * same key replay the original envelope verbatim instead of appending
 * again — the failure mode otherwise (duplicate text per retry) is
 * silent at the API surface.
 *
 * @throws {NotFound} when the task or project ID does not exist
 */
export async function handleNoteAppend(
  input: NoteAppendToolInput,
  ctx: NoteAppendContext,
): Promise<ToolSuccess<NoteAppendData>> {
  const store = ctx.idempotencyStore ?? defaultIdempotencyStore;

  // The inner fn always returns `ok()` which is `ToolSuccess`. The
  // withIdempotencyKey wrapper widens to `ToolEnvelope` (in case a cached
  // error envelope is ever replayed), but in this code path the cached
  // value is always a success. Narrow back so callers don't need to
  // discriminate.
  const envelope = (await withIdempotencyKey(
    store,
    input.idempotency_key,
    async (): Promise<ToolEnvelope<NoteAppendData>> => {
      // Single read fetches both the existing note and the parent's display
      // name; no extra round trip for the lever-4 name pairing (#606). The
      // task's projectId / parentId ride along so their scopes flush too.
      let existing: string | null;
      let name: string;
      let taskProjectId: ProjectId | null = null;
      let taskParentId: TaskId | null = null;
      if (input.targetKind === "task") {
        const task = await ctx.adapter.getTask(TaskId.of(input.id));
        existing = task.note;
        name = task.name;
        taskProjectId = task.projectId;
        taskParentId = task.parentId;
      } else {
        const project = await ctx.adapter.getProject(ProjectId.of(input.id));
        existing = project.note;
        name = project.name;
      }

      const combined = existing ? `${existing}\n${input.text}` : input.text;

      if (input.targetKind === "task") {
        await ctx.adapter.updateTask(TaskId.of(input.id), { note: combined });
        if (ctx.cache !== undefined) {
          invalidateTaskMutation(ctx.cache, {
            taskId: TaskId.of(input.id),
            projectId: taskProjectId,
            parentId: taskParentId,
          });
        }
      } else {
        await ctx.adapter.updateProject(ProjectId.of(input.id), { note: combined });
        if (ctx.cache !== undefined) {
          invalidateProjectMutation(ctx.cache, { projectId: ProjectId.of(input.id) });
        }
      }

      return ok<NoteAppendData>(
        {
          updated: true as const,
          id: input.id,
          targetKind: input.targetKind,
          name,
          note: combined,
        },
        ctx.makeMeta({
          syncPending: true,
          humanReadableSummary: summaryNoteAppend(input.targetKind, name),
        }),
      );
    },
  )) as ToolSuccess<NoteAppendData>;
  return envelope;
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
      return toolResponse(envelope);
    },
  );
}
