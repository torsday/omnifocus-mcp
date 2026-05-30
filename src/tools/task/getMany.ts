/**
 * `task_get_many` MCP tool — fetch up to 100 tasks by persistent ID in one
 * OmniFocus round-trip.
 *
 * Agents frequently accumulate task IDs from multiple sources (a perspective
 * result, a search result, a resource read) and need full task objects for
 * all of them. Without this tool they would make N serial `task_get` calls;
 * this batches them into one JXA script invocation.
 *
 * ## Behaviour
 *
 * - Tasks are returned in the **same order** as the input `ids` array.
 * - IDs that are not found (deleted, never existed) are **omitted** from the
 *   result — they are **not** errors. They surface in `meta.warnings` under
 *   the `WARN_IDS_NOT_FOUND` code with `details.missing` listing the IDs.
 * - An empty `ids` array returns `[]` immediately without touching OmniFocus.
 * - Passing more than 100 IDs returns `OF_VALIDATION` (too large to batch).
 *
 * @see DESIGN.md §26 — tool pattern
 * @see src/envelope/index.ts — WARN_IDS_NOT_FOUND builder
 * @see src/adapter/OmniFocusAdapter.ts — getTasksMany contract
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type Decision, parseDecision } from "../../domain/decisionJournal.js";
import { TaskId } from "../../domain/ids.js";
import { TASK_FIELD_NAMES, TASK_FIELD_NAMES_SET } from "../../domain/task.js";
import { parseWaitingOn, type WaitingOn } from "../../domain/waitingOn.js";
import { applyByteCapById } from "../../envelope/cap.js";
import { TASK_DEFAULTS } from "../../envelope/defaultsRegistry.js";
import { elideDefaultsAll } from "../../envelope/elideDefaults.js";
import {
  ok,
  type ResponseMeta,
  toolResponse,
  type Warning,
  warnIdsNotFound,
  warnResultTruncatedBytes,
  warnUnknownFields,
} from "../../envelope/index.js";
import { applyProjection, validateFields } from "../../envelope/projection.js";
import { ValidationError } from "../../errors/index.js";
import { applyNotePreview, DEFAULT_NOTE_PREVIEW_CHARS } from "./notePreview.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_GET_MANY_DESCRIPTION =
  "Fetch up to 100 tasks by persistent ID in a single OmniFocus round-trip. " +
  "Use when you have a set of task IDs from multiple sources and need full task objects for all of them. " +
  "Do NOT use for a single ID — use task_get instead. " +
  "Do NOT use when you only have names — use task_find_by_name. " +
  "Returns Task[] in input order. Missing IDs are omitted and appear in meta.warnings. " +
  "Read-only; safe to retry. " +
  'Example: task_get_many({ ids: ["abc123", "abc456"] })';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_IDS = 100;

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskGetManyInputSchema = z.object({
  ids: z
    .array(TaskId.schema)
    .min(0)
    .max(MAX_IDS)
    .describe(
      `Array of task IDs to fetch (0..${MAX_IDS}). Get IDs from task_list, search_query, or task_find_by_name. Missing IDs are omitted (not errors) and appear in meta.warnings.`,
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
      "When true, return the full unelided task shape. " +
        "Default: false — fields equal to their documented default are omitted. " +
        "See docs/token-cost.md for the defaults table.",
    ),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict each returned task to this list of top-level fields (id is always returned). " +
        "Omit for the full task shape. Empty array returns just id. " +
        "Unknown names surface in meta.warnings.WARN_UNKNOWN_FIELDS.",
    ),
  maxOutputBytes: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Cap the serialized byte size of the returned tasks[] array. When the response would exceed this, " +
        "the server returns as many whole tasks as fit (in input order), sets meta.truncatedAtCap=true with " +
        "meta.bytesReturned and meta.itemsReturned, and lists the trimmed ids in meta.warnings.WARN_RESULT_TRUNCATED " +
        "details.droppedIds — re-request those in a smaller batch or with a higher cap. Omit for no cap. " +
        "Values above the server's hard ceiling (~1 MiB) are clamped. A single task larger than the cap is still " +
        "returned whole so the batch always makes progress.",
    ),
});

export type TaskGetManyInput = z.infer<typeof taskGetManyInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskGetManyContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests.
 *
 * Delegates to `adapter.getTasksMany` which returns `(Task | null)[]` with
 * `null` for each position where the ID was not found. This handler strips
 * the nulls and emits a `WARN_IDS_NOT_FOUND` warning if any were missing.
 */
export async function handleTaskGetMany(input: TaskGetManyInput, ctx: TaskGetManyContext) {
  // Fast path — empty input never touches the adapter
  if (input.ids.length === 0) {
    return ok({ tasks: [] }, ctx.makeMeta());
  }

  // The Zod schema already enforces max 100, but guard defensively for
  // callers that bypass schema validation (e.g. direct handler tests).
  if (input.ids.length > MAX_IDS) {
    throw new ValidationError(
      `ids array exceeds the maximum batch size of ${MAX_IDS} (got ${input.ids.length})`,
      { details: { field: "ids" } },
    );
  }

  const raw = await ctx.adapter.getTasksMany(input.ids);

  const fullTasks = raw.filter((t): t is NonNullable<typeof t> => t !== null);
  const missing = input.ids.filter((_id, i) => raw[i] === null);

  // Surface parsed waiting-on and decision-journal data as sibling fields
  // keyed by task id so the Task domain object stays the canonical wire shape
  // (#482, #485). Parse against the full note before applying truncation.
  const waitingOn: Record<string, WaitingOn> = {};
  const decisions: Record<string, Decision> = {};
  for (const t of fullTasks) {
    const w = parseWaitingOn(t.note);
    if (w !== undefined) waitingOn[t.id] = w;
    const d = parseDecision(t.note);
    if (d !== undefined) decisions[t.id] = d;
  }
  const previewChars = input.notePreviewChars ?? DEFAULT_NOTE_PREVIEW_CHARS;

  const projection =
    input.fields !== undefined ? validateFields(input.fields, TASK_FIELD_NAMES_SET) : undefined;
  const projectFields = projection?.valid;

  const previewed = fullTasks.map((t) =>
    applyNotePreview(applyProjection(t, projectFields), previewChars),
  );
  // fields[] = explicit mode → skip elide-defaults so requested fields aren't silently dropped.
  const applyElide = input.verbose !== true && projectFields === undefined;
  const tasks = applyElide ? elideDefaultsAll(previewed, TASK_DEFAULTS) : previewed;

  // Cap stage (#776/#1060) — runs last. No cursor on bulk-by-id reads, so the
  // dropped tail is reported by id (ADR-0024) rather than via a continuation cursor.
  const cap = applyByteCapById(tasks, {
    ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
    idOf: (t) => (t as { id: string }).id,
  });

  // Drop waitingOn/decisions entries for tasks trimmed by the cap (both are keyed by id).
  const keptIds = cap.truncatedAtCap
    ? new Set(cap.items.map((t) => (t as { id: string }).id))
    : null;
  const keepById = <V>(m: Record<string, V>): Record<string, V> =>
    keptIds === null ? m : Object.fromEntries(Object.entries(m).filter(([id]) => keptIds.has(id)));
  const keptWaitingOn = keepById(waitingOn);
  const keptDecisions = keepById(decisions);

  const warnings: Warning[] = [];
  if (missing.length > 0) warnings.push(warnIdsNotFound(missing));
  if (projection !== undefined && projection.unknown.length > 0) {
    warnings.push(warnUnknownFields([...projection.unknown], TASK_FIELD_NAMES));
  }
  if (cap.truncatedAtCap) {
    warnings.push(warnResultTruncatedBytes(cap.bytesReturned, cap.itemsReturned, cap.droppedIds));
  }

  const meta = ctx.makeMeta({
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(cap.truncatedAtCap
      ? {
          truncatedAtCap: true,
          bytesReturned: cap.bytesReturned,
          itemsReturned: cap.itemsReturned,
        }
      : {}),
  });

  return ok(
    {
      tasks: cap.items,
      ...(Object.keys(keptWaitingOn).length > 0 && { waitingOn: keptWaitingOn }),
      ...(Object.keys(keptDecisions).length > 0 && { decisions: keptDecisions }),
    },
    meta,
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskGetManyTool(server: McpServer, ctx: TaskGetManyContext) {
  return server.registerTool(
    "task_get_many",
    {
      description: TASK_GET_MANY_DESCRIPTION,
      inputSchema: taskGetManyInputSchema.shape,
    },
    async (args: TaskGetManyInput) => {
      const envelope = await handleTaskGetMany(args, ctx);
      return toolResponse(envelope);
    },
  );
}
