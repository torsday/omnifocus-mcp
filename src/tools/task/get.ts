/**
 * `task_get` MCP tool — fetch a single OmniFocus task by persistent ID.
 *
 * Use when you have a known task ID and need its full detail — optionally
 * including its direct subtask list. For multiple IDs, prefer task_get_many.
 * For lookups by name, use task_find_by_name (when it exists).
 *
 * @see DESIGN.md §26 — tool pattern
 * @see src/services/taskService.ts — TaskService.get
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseDecision } from "../../domain/decisionJournal.js";
import { TaskId } from "../../domain/ids.js";
import { parseWaitingOn } from "../../domain/waitingOn.js";
import { TASK_DEFAULTS } from "../../envelope/defaultsRegistry.js";
import { elideDefaults, elideDefaultsAll } from "../../envelope/elideDefaults.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { TaskGetInput, TaskService } from "../../services/taskService.js";
import { applyNotePreview, DEFAULT_NOTE_PREVIEW_CHARS } from "./notePreview.js";

export const TASK_GET_DESCRIPTION =
  "Fetch a single OmniFocus task by persistent ID. " +
  "Use when you have a known task ID and need its full detail. " +
  "Do NOT use for multiple IDs — use task_get_many instead. " +
  "Returns the Task object plus its direct subtasks (when includeSubtasks=true, the default). " +
  "Read-only; safe to retry. " +
  'Example: task_get({ id: "abc123" })';

export const taskGetInputSchema = z.object({
  id: TaskId.schema.describe(
    "Persistent ID of the task to fetch. Get from task_list or task_get_many.",
  ),
  includeSubtasks: z
    .boolean()
    .optional()
    .describe("Include direct subtasks in the response. Default true."),
  notePreviewChars: z
    .number()
    .int()
    .optional()
    .describe(
      `Maximum characters of the task's note (and each subtask's note) to return. Default ${DEFAULT_NOTE_PREVIEW_CHARS}. ` +
        "When a note exceeds this length, the response replaces `note` with `notePreview` (the truncated text), `noteTruncated: true`, and `noteLength` (full UTF-8 byte length) — fetch the full text with note_get. " +
        "Pass -1 to disable truncation and return full notes inline.",
    ),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "When true, return the full unelided task shape (every field present, even at defaults). " +
        "Default: false — fields equal to their documented default are omitted. " +
        "See docs/token-cost.md for the defaults table.",
    ),
});

export type TaskGetToolInput = z.infer<typeof taskGetInputSchema>;

export interface TaskGetContext {
  taskService: TaskService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for task_get.
 * @throws {NotFound} when the task ID does not exist
 * @throws {OmniFocusNotRunning} when OmniFocus is not running
 */
export async function handleTaskGet(input: TaskGetToolInput, ctx: TaskGetContext) {
  const { notePreviewChars: rawPreviewChars, verbose, ...rest } = input;
  const result = await ctx.taskService.get(rest as TaskGetInput);
  // Parse waitingOn / decision against the full note before applying truncation.
  const waitingOn = parseWaitingOn(result.task.note);
  const decision = parseDecision(result.task.note);
  const previewChars = rawPreviewChars ?? DEFAULT_NOTE_PREVIEW_CHARS;
  const previewedTask = applyNotePreview(result.task, previewChars);
  const previewedSubtasks = result.subtasks?.map((t) => applyNotePreview(t, previewChars));
  const task = verbose === true ? previewedTask : elideDefaults(previewedTask, TASK_DEFAULTS);
  const subtasks =
    previewedSubtasks === undefined
      ? undefined
      : verbose === true
        ? previewedSubtasks
        : elideDefaultsAll(previewedSubtasks, TASK_DEFAULTS);
  return ok(
    {
      task,
      ...(subtasks !== undefined && { subtasks }),
      ...(waitingOn !== undefined && { waitingOn }),
      ...(decision !== undefined && { decision }),
    },
    ctx.makeMeta({ cacheHit: result.cacheHit }),
  );
}

export function registerTaskGetTool(server: McpServer, ctx: TaskGetContext) {
  return server.registerTool(
    "task_get",
    { description: TASK_GET_DESCRIPTION, inputSchema: taskGetInputSchema.shape },
    async (args: TaskGetToolInput) => {
      const envelope = await handleTaskGet(args, ctx);
      return toolResponse(envelope);
    },
  );
}
