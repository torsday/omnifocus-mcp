/**
 * `task_set_waiting_on` and `task_clear_waiting_on` MCP tools.
 *
 * Records "I am waiting on X for Y since Z, nudge me after W" as structured
 * metadata on a task. Two side effects per write:
 *
 * 1. The configured `@waiting` tag (env `OMNIFOCUS_WAITING_TAG_NAME`,
 *    default `waiting`) is added to the task — created if absent — so the
 *    task surfaces in any existing waiting-on perspective the user has.
 * 2. A fenced `waiting-on` block is upserted in the task's note via
 *    `src/domain/waitingOn.ts`. The fence preserves any existing user prose.
 *
 * The clear tool reverses both side effects atomically (best-effort; the two
 * writes are not transactional but both are idempotent).
 *
 * @see #482 — feature spec
 * @see src/resources/waitingOn.ts — omnifocus://waiting-on aggregator
 * @see src/domain/waitingOn.ts — parser and serializer
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { type TagId, TaskId } from "../../domain/ids.js";
import {
  clearWaitingOn,
  type WaitingOn,
  waitingOnSchema,
  writeWaitingOn,
} from "../../domain/waitingOn.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool descriptions
// ---------------------------------------------------------------------------

export const TASK_SET_WAITING_ON_DESCRIPTION =
  "Record that an OmniFocus task is waiting on someone or something. " +
  "Tags the task with the configured @waiting tag (creating the tag if absent) " +
  "and writes a structured `waiting-on` fenced block to the top of the task note. " +
  "The fence preserves any existing user prose in the note. " +
  "Round-trips through task_get / task_get_many as a structured `waitingOn` field. " +
  "Surfaces in the omnifocus://waiting-on resource sorted by days overdue. " +
  "Use to systematize follow-ups; do NOT use for task completion or scheduling. " +
  "Returns { id, waitingOn } with the persisted entry. " +
  "Side effects: writes tag + note; sets meta.syncPending = true. " +
  'Example: { "taskId": "abc123", "whom": "Alex", "what": "design review", "followUpAfter": "2026-05-05T17:00:00Z" }';

export const TASK_CLEAR_WAITING_ON_DESCRIPTION =
  "Clear waiting-on tracking from an OmniFocus task. " +
  "Strips the `waiting-on` fenced block from the task note (preserving any other user prose) " +
  "and removes the configured @waiting tag from the task. " +
  "Idempotent: returns noChange:true when the task has no waiting-on data. " +
  "Do NOT use to delete the task or remove unrelated tags — prefer task_delete or task_update instead. " +
  "Returns { id, cleared:true } or { id, noChange:true }. " +
  "Side effects: writes tag + note; sets meta.syncPending = true. " +
  'Example: { "taskId": "abc123" }';

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

export const taskSetWaitingOnInputSchema = z.object({
  taskId: TaskId.schema.describe("Persistent task ID."),
  whom: z.string().min(1).describe("Person, team, or system being waited on. Required."),
  what: z
    .string()
    .min(1)
    .optional()
    .describe("Optional short description of what is being waited on."),
  since: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("ISO-8601 date the wait began. Defaults to now. Use to backfill historical waits."),
  followUpAfter: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      "ISO-8601 date past which the agent should nudge if still unresolved. " +
        "Drives daysOverdue in the omnifocus://waiting-on resource.",
    ),
});

export type TaskSetWaitingOnInput = z.infer<typeof taskSetWaitingOnInputSchema>;

export const taskClearWaitingOnInputSchema = z.object({
  taskId: TaskId.schema.describe("Persistent task ID."),
});

export type TaskClearWaitingOnInput = z.infer<typeof taskClearWaitingOnInputSchema>;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface TaskWaitingOnContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
  /** Configured @waiting tag name. Resolved from `OMNIFOCUS_WAITING_TAG_NAME`. */
  waitingTagName: string;
}

// ---------------------------------------------------------------------------
// Tag resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a tag by case-insensitive name, creating it if absent. Mirrors the
 * pattern in `exportService.ts` (no centralized helper exists yet).
 */
async function resolveOrCreateTag(adapter: OmniFocusAdapter, name: string): Promise<TagId> {
  const all = await adapter.listTags();
  const key = name.toLowerCase();
  const existing = all.find((t) => t.name.toLowerCase() === key);
  if (existing !== undefined) return existing.id;
  return adapter.createTag({ name });
}

// ---------------------------------------------------------------------------
// task_set_waiting_on
// ---------------------------------------------------------------------------

/**
 * Pure handler for `task_set_waiting_on`.
 *
 * @throws {NotFound} when the task ID does not exist
 */
export async function handleTaskSetWaitingOn(
  input: TaskSetWaitingOnInput,
  ctx: TaskWaitingOnContext,
) {
  const task = await ctx.adapter.getTask(input.taskId);

  const entry: WaitingOn = waitingOnSchema.parse({
    whom: input.whom,
    ...(input.what !== undefined && { what: input.what }),
    since: input.since ?? new Date().toISOString(),
    ...(input.followUpAfter !== undefined && { followUpAfter: input.followUpAfter }),
  });

  const newNote = writeWaitingOn(task.note, entry);
  const tagId = await resolveOrCreateTag(ctx.adapter, ctx.waitingTagName);
  const tagIds = task.tagIds.includes(tagId) ? task.tagIds : [...task.tagIds, tagId];

  await ctx.adapter.updateTask(input.taskId, { note: newNote, tagIds });

  if (ctx.cache !== undefined) {
    invalidateTaskMutation(ctx.cache, {
      taskId: input.taskId,
      projectId: task.projectId,
      parentId: task.parentId,
    });
  }

  return ok({ id: input.taskId, waitingOn: entry }, ctx.makeMeta({ syncPending: true }));
}

export function registerTaskSetWaitingOnTool(server: McpServer, ctx: TaskWaitingOnContext) {
  return server.registerTool(
    "task_set_waiting_on",
    {
      description: TASK_SET_WAITING_ON_DESCRIPTION,
      inputSchema: taskSetWaitingOnInputSchema.shape,
    },
    async (args: TaskSetWaitingOnInput) => {
      const envelope = await handleTaskSetWaitingOn(args, ctx);
      return toolResponse(envelope);
    },
  );
}

// ---------------------------------------------------------------------------
// task_clear_waiting_on
// ---------------------------------------------------------------------------

/**
 * Pure handler for `task_clear_waiting_on`.
 *
 * Idempotent — returns `noChange: true` when neither the fence nor the tag is
 * present.
 *
 * @throws {NotFound} when the task ID does not exist
 */
export async function handleTaskClearWaitingOn(
  input: TaskClearWaitingOnInput,
  ctx: TaskWaitingOnContext,
) {
  const task = await ctx.adapter.getTask(input.taskId);
  const newNote = clearWaitingOn(task.note);

  // Resolve the tag without creating: a clear that finds no tag should not
  // add the tag as a side effect.
  const all = await ctx.adapter.listTags();
  const key = ctx.waitingTagName.toLowerCase();
  const tagId = all.find((t) => t.name.toLowerCase() === key)?.id;
  const hadTag = tagId !== undefined && task.tagIds.includes(tagId);
  const noteChanged = newNote !== task.note;

  if (!hadTag && !noteChanged) {
    return ok({ id: input.taskId, noChange: true as const }, ctx.makeMeta());
  }

  const patch: { note?: string | null; tagIds?: TagId[] } = {};
  if (noteChanged) patch.note = newNote;
  if (hadTag && tagId !== undefined) {
    patch.tagIds = task.tagIds.filter((id) => id !== tagId);
  }

  await ctx.adapter.updateTask(input.taskId, patch);

  if (ctx.cache !== undefined) {
    invalidateTaskMutation(ctx.cache, {
      taskId: input.taskId,
      projectId: task.projectId,
      parentId: task.parentId,
    });
  }

  return ok({ id: input.taskId, cleared: true as const }, ctx.makeMeta({ syncPending: true }));
}

export function registerTaskClearWaitingOnTool(server: McpServer, ctx: TaskWaitingOnContext) {
  return server.registerTool(
    "task_clear_waiting_on",
    {
      description: TASK_CLEAR_WAITING_ON_DESCRIPTION,
      inputSchema: taskClearWaitingOnInputSchema.shape,
    },
    async (args: TaskClearWaitingOnInput) => {
      const envelope = await handleTaskClearWaitingOn(args, ctx);
      return toolResponse(envelope);
    },
  );
}
