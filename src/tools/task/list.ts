/**
 * `task_list` MCP tool — the reference implementation for read-shaped tools
 * in this server (DESIGN §26).
 *
 * Every other list tool inherits this structure:
 * - A zod input schema whose `.describe()` strings are the contract the LLM
 *   reads. Concise, imperative, says where to get IDs (see DESIGN §6.8.1).
 * - A thin handler (< 30 LOC per DESIGN maintainability target) that delegates
 *   to a `Service` method and wraps the result in the ADR-0013 envelope.
 * - No business logic in the handler — filter application, pagination,
 *   caching all live in the service.
 *
 * The `registerTaskListTool` helper is what `mcpServer.ts` calls to register
 * this tool with a configured {@link TaskService}.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see DESIGN.md §12 — response envelope
 * @see src/services/taskService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { flexDateString } from "../../domain/dates.js";
import { ProjectId, TagId, TaskId } from "../../domain/ids.js";
import { TASK_FIELD_NAMES, TASK_FIELD_NAMES_SET, type Task } from "../../domain/task.js";
import { applyByteCap } from "../../envelope/cap.js";
import { TASK_DEFAULTS } from "../../envelope/defaultsRegistry.js";
import { elideDefaults } from "../../envelope/elideDefaults.js";
import {
  ok,
  type Pagination,
  type ResponseMeta,
  toolResponse,
  type Warning,
  warnResultTruncatedBytes,
  warnUnknownFields,
} from "../../envelope/index.js";
import { applyProjection, validateFields } from "../../envelope/projection.js";
import type { TaskListInput, TaskService } from "../../services/taskService.js";
import { TaskSortBySchema } from "../../services/taskService.js";
import { resolveNotePreviewChars } from "../../state/sessionState.js";
import { applyNotePreview, DEFAULT_NOTE_PREVIEW_CHARS } from "./notePreview.js";

// ---------------------------------------------------------------------------
// Tool description (shown to the LLM via tools/list)
// ---------------------------------------------------------------------------

export const TASK_LIST_DESCRIPTION =
  "List tasks in OmniFocus with optional filters (project, tag, inbox, flagged, completion, due dates). " +
  "Use inbox=true to fetch unprocessed Inbox tasks. " +
  "Use this for filter-based queries across tasks. " +
  "Do NOT use for a known single task (use task_get). " +
  "For name-based lookup, prefer task_find_by_name. " +
  "For full-text content search across names and notes, prefer search_query. " +
  "Returns tasks[] with pagination; safe to call repeatedly; no side effects. " +
  "Example: task_list({ inbox: true }) " +
  'Example: task_list({ projectId: "prj123", flagged: true }) ' +
  'Example: task_list({ dueBefore: "2026-05-01T00:00:00Z", completed: "exclude" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Raw-shape input schema for `task_list`. Exported as a zod object so the
 * MCP SDK can introspect it for `tools/list`, and so unit tests can parse
 * arbitrary payloads through it without re-declaring the types.
 *
 * Field descriptions follow DESIGN §6.8.1: what it does, where to get IDs,
 * what the default means if one is applied.
 */
export const taskListInputSchema = z.object({
  projectId: ProjectId.schema
    .optional()
    .describe(
      "Restrict to tasks in this project. Get the ID from project_list. Omit for all projects.",
    ),
  tagIds: z
    .array(TagId.schema)
    .optional()
    .describe("Restrict to tasks carrying ALL of these tag IDs. Get IDs from tag_list."),
  flagged: z
    .boolean()
    .optional()
    .describe("true = flagged only; false = unflagged only; omit = all."),
  available: z
    .boolean()
    .optional()
    .describe(
      "true = only tasks available to work on now (not blocked, not deferred). Omit = all.",
    ),
  completed: z
    .enum(["any", "only", "exclude"])
    .optional()
    .describe(
      "'exclude' = active tasks only; 'only' = completed tasks only; 'any' = both. Omit for adapter default.",
    ),
  dueBefore: z
    .string()
    .optional()
    .describe(
      "Tasks with dueDate strictly before this moment. ISO-8601 with offset (e.g. '2026-04-21T17:00:00-04:00').",
    ),
  dueAfter: z
    .string()
    .optional()
    .describe("Tasks with dueDate strictly after this moment. ISO-8601 with offset."),
  deferredBefore: z
    .string()
    .optional()
    .describe(
      "Tasks deferred until before this moment (already unlocked or soon). ISO-8601 with offset.",
    ),
  parentId: TaskId.schema
    .optional()
    .describe(
      "Restrict to direct children of this task (subtasks). Get the ID from task_get or task_list.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Max tasks per page (1..1000). Default 50. Use `cursor` to fetch subsequent pages."),
  sortBy: TaskSortBySchema.optional().describe(
    "Field to sort tasks by: 'createdAt' (default), 'dueDate', 'modifiedAt', or 'name'. " +
      "Tasks with no value for the chosen field (e.g. no dueDate) sort last.",
  ),
  sortDirection: z
    .enum(["asc", "desc"])
    .optional()
    .describe(
      "Sort direction: 'asc' (default, oldest/lowest first) or 'desc' (newest/highest first).",
    ),
  updatedSince: flexDateString()
    .optional()
    .describe(
      "Return only tasks modified strictly after this timestamp. " +
        "Accepts ISO-8601 with offset (e.g. '2026-04-21T10:00:00-07:00') or a relative shortcut: " +
        "today, yesterday, this-week, next-week, end-of-week, end-of-month. " +
        "Use this for incremental sync: call without updatedSince on session start, then pass the previous response timestamp on subsequent calls. " +
        "Note: deleted tasks cannot be detected — use a snapshot resource for deletion detection.",
    ),
  inbox: z
    .boolean()
    .optional()
    .describe(
      "true = Inbox tasks only (no project assignment). " +
        "Cannot be combined with projectId or parentId. " +
        "Use this to surface unprocessed captures without knowing their IDs.",
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque cursor from a previous task_list response. Must use the same filters — changing filters mid-sequence returns a ValidationError.",
    ),
  notePreviewChars: z
    .number()
    .int()
    .optional()
    .describe(
      `Maximum characters of each task's note to return. Default ${DEFAULT_NOTE_PREVIEW_CHARS}. ` +
        "When a note exceeds this length, the response replaces `note` with `notePreview` (the truncated text), `noteTruncated: true`, and `noteLength` (full UTF-8 byte length) — fetch the full text with note_get. " +
        "Pass -1 to disable truncation and return full notes inline.",
    ),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "When true, return the full unelided task shape (every field present, even at defaults). " +
        "Default: false — fields equal to their documented default (flagged: false, completed: false, " +
        "tagIds: [], note: null, dueDate: null, etc.) are omitted from the wire payload. " +
        "An omitted field means the default applies. See docs/token-cost.md for the full defaults table.",
    ),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict each returned task to this list of top-level fields (id is always returned). " +
        "Omit for the full task shape. Empty array returns just id. " +
        "Unknown names surface in meta.warnings.WARN_UNKNOWN_FIELDS.",
    ),
  includeLinks: z
    .boolean()
    .optional()
    .describe(
      "When true, each task carries a `_links` HATEOAS block (self, project, parent, tags). " +
        "Default false — the block is omitted to save payload size. " +
        "Use the task's `id`, `projectId`, `parentId`, and `tagIds` fields directly instead.",
    ),
  maxOutputBytes: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Cap the serialized byte size of the returned tasks[] array. When the response would exceed this, " +
        "the server returns as many whole tasks as fit, sets meta.truncatedAtCap=true with " +
        "meta.bytesReturned and meta.itemsReturned, and returns a pagination cursor that resumes at the " +
        "first dropped task. Omit for no cap. Values above the server's hard ceiling (~1 MiB) are clamped. " +
        "A single task larger than the cap is still returned whole so pagination always advances.",
    ),
});

/** TypeScript input type derived from {@link taskListInputSchema}. */
export type TaskListToolInput = z.infer<typeof taskListInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Minimum meta-factory interface the handler needs. */
export interface ToolContext {
  taskService: TaskService;
  /** Produce request-scoped response meta. Supplied by the handler harness. */
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — separated from {@link registerTaskListTool} so unit tests
 * can invoke it without constructing an McpServer.
 */
export async function handleTaskList(input: TaskListToolInput, ctx: ToolContext) {
  const { notePreviewChars: rawPreviewChars, verbose, fields, maxOutputBytes, ...rest } = input;
  const serviceInput = rest as TaskListInput;
  const result = await ctx.taskService.list(serviceInput);
  const previewChars = resolveNotePreviewChars(rawPreviewChars);

  const projection =
    fields !== undefined ? validateFields(fields, TASK_FIELD_NAMES_SET) : undefined;
  const projectFields = projection?.valid;
  const fieldWarnings =
    projection !== undefined && projection.unknown.length > 0
      ? [warnUnknownFields([...projection.unknown], TASK_FIELD_NAMES)]
      : [];

  // When fields[] is specified the caller is being explicit — skip elide-defaults
  // so requested fields are never silently dropped. verbose=true also bypasses
  // elide-defaults. Default (no fields, no verbose) applies elide-defaults.
  const applyElide = verbose !== true && projectFields === undefined;
  const wireTasks = result.tasks.map((t) => {
    const projected = applyProjection(t, projectFields);
    const previewed = applyNotePreview(projected, previewChars);
    return applyElide ? elideDefaults(previewed, TASK_DEFAULTS) : previewed;
  });

  // Cap stage (#776) — runs last so it measures the true post-elide/post-preview
  // wire size. Re-anchor the continuation cursor at the last *kept* task so a
  // trimmed page resumes exactly where it was cut (not at the full page's end).
  const cap = applyByteCap(wireTasks, {
    ...(maxOutputBytes !== undefined ? { maxOutputBytes } : {}),
    cursorFor: (lastKeptIndex) =>
      ctx.taskService.cursorForListItem(result.tasks[lastKeptIndex] as Task, serviceInput),
  });

  const pagination: Pagination = cap.truncatedAtCap
    ? { cursor: cap.cursor, hasMore: true }
    : { cursor: result.nextCursor, hasMore: result.hasMore };

  const warnings: Warning[] = cap.truncatedAtCap
    ? [...fieldWarnings, warnResultTruncatedBytes(cap.bytesReturned, cap.itemsReturned)]
    : fieldWarnings;

  const meta = ctx.makeMeta({
    cacheHit: result.cacheHit,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(cap.truncatedAtCap
      ? {
          truncatedAtCap: true,
          bytesReturned: cap.bytesReturned,
          itemsReturned: cap.itemsReturned,
        }
      : {}),
  });
  return ok({ tasks: cap.items }, meta, pagination);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register `task_list` with an `McpServer` instance. The returned handle is
 * the SDK's `RegisteredTool` — callers may ignore it.
 */
export function registerTaskListTool(server: McpServer, ctx: ToolContext) {
  return server.registerTool(
    "task_list",
    {
      description: TASK_LIST_DESCRIPTION,
      inputSchema: taskListInputSchema.shape,
    },
    async (args: TaskListToolInput) => {
      const envelope = await handleTaskList(args, ctx);
      return toolResponse(envelope);
    },
  );
}
