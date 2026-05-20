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
import { TASK_FIELD_NAMES, TASK_FIELD_NAMES_SET } from "../../domain/task.js";
import { parseWaitingOn } from "../../domain/waitingOn.js";
import { TASK_DEFAULTS } from "../../envelope/defaultsRegistry.js";
import { elideDefaults, elideDefaultsAll } from "../../envelope/elideDefaults.js";
import { ok, type ResponseMeta, toolResponse, warnUnknownFields } from "../../envelope/index.js";
import { applyProjection, validateFields } from "../../envelope/projection.js";
import type { TaskGetInput, TaskService } from "../../services/taskService.js";
import { applyNotePreview, DEFAULT_NOTE_PREVIEW_CHARS } from "./notePreview.js";

export const TASK_GET_DESCRIPTION =
  "Fetch a single OmniFocus task by persistent ID. " +
  "Use when you have a known task ID and need its full detail. " +
  "Do NOT use for multiple IDs — use task_get_many instead. " +
  "Returns the Task object plus subtaskIds[] and subtaskCount (when includeSubtasks omitted or false). " +
  "Pass includeSubtasks: true to get full subtask bodies; use task_get_many to fetch specific subtasks by ID. " +
  "Read-only; safe to retry. " +
  'Example: task_get({ id: "abc123" })';

export const taskGetInputSchema = z.object({
  id: TaskId.schema.describe(
    "Persistent ID of the task to fetch. Get from task_list or task_get_many.",
  ),
  includeSubtasks: z
    .boolean()
    .optional()
    .describe(
      "Include full subtask bodies in the response. Default false — returns subtaskIds[] and subtaskCount instead. " +
        "Pass true only when you need subtask detail; otherwise use task_get_many with subtaskIds.",
    ),
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
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict the returned task (and each subtask) to this list of top-level fields (id is always returned). " +
        "Omit for the full task shape. Empty array returns just id. " +
        "Unknown names surface in meta.warnings.WARN_UNKNOWN_FIELDS.",
    ),
  includeLinks: z
    .boolean()
    .optional()
    .describe(
      "When true, the task (and each subtask, if requested) carries a `_links` HATEOAS block " +
        "(self, project, parent, tags). Default false — the block is omitted to save payload size. " +
        "Use `id`, `projectId`, `parentId`, and `tagIds` directly instead.",
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
  const { notePreviewChars: rawPreviewChars, verbose, fields, ...rest } = input;
  const result = await ctx.taskService.get(rest as TaskGetInput);
  // Parse waitingOn / decision against the full note before truncation/projection.
  const waitingOn = parseWaitingOn(result.task.note);
  const decision = parseDecision(result.task.note);
  const previewChars = rawPreviewChars ?? DEFAULT_NOTE_PREVIEW_CHARS;

  const projection =
    fields !== undefined ? validateFields(fields, TASK_FIELD_NAMES_SET) : undefined;
  const projectFields = projection?.valid;
  const warnings =
    projection !== undefined && projection.unknown.length > 0
      ? [warnUnknownFields([...projection.unknown], TASK_FIELD_NAMES)]
      : undefined;

  const previewedTask = applyNotePreview(applyProjection(result.task, projectFields), previewChars);
  const previewedSubtasks = result.subtasks?.map((t) =>
    applyNotePreview(applyProjection(t, projectFields), previewChars),
  );

  // fields[] = explicit mode → skip elide-defaults so requested fields aren't silently dropped.
  const applyElide = verbose !== true && projectFields === undefined;
  const task = applyElide ? elideDefaults(previewedTask, TASK_DEFAULTS) : previewedTask;
  const subtasks =
    previewedSubtasks === undefined
      ? undefined
      : applyElide
        ? elideDefaultsAll(previewedSubtasks, TASK_DEFAULTS)
        : previewedSubtasks;

  return ok(
    {
      task,
      ...(result.subtaskIds !== undefined && { subtaskIds: result.subtaskIds }),
      ...(result.subtaskCount !== undefined && { subtaskCount: result.subtaskCount }),
      ...(subtasks !== undefined && { subtasks }),
      ...(waitingOn !== undefined && { waitingOn }),
      ...(decision !== undefined && { decision }),
    },
    ctx.makeMeta({
      cacheHit: result.cacheHit,
      ...(warnings !== undefined ? { warnings } : {}),
    }),
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
