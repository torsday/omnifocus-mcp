/**
 * `task_move` MCP tool — reparent a task to a different project, another
 * task (as a subtask), or the inbox.
 *
 * Exactly one of `projectId`, `parentId`, or `toInbox: true` must be set.
 * The `moveTask` adapter method is already part of the OmniFocusAdapter
 * contract (#30); this tool is the agent-facing surface.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/adapter/OmniFocusAdapter.ts — moveTask signature
 * @see src/tools/project/move (analog) / src/tools/folder/move.ts (analog)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import { summaryTaskMove } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_MOVE_DESCRIPTION =
  "Move an OmniFocus task to a new location — a different project, another task " +
  "(as a subtask), or the inbox. Exactly one destination must be specified: " +
  "projectId, parentId, or toInbox: true. " +
  "Do NOT use task_move to reorder siblings within the same parent (task_reorder handles that); " +
  "prefer task_update when you only need to change editable fields, not reparent. " +
  "Idempotent: returns noChange: true when the task is already at the destination. " +
  "Returns { moved: true, id, from, to } or { noChange: true, id, at }. " +
  "Side effects: reparents the task in OmniFocus, sets meta.syncPending = true. " +
  'Example: task_move({ id: "abc123", projectId: "prj456" }) ' +
  'Example: task_move({ id: "abc123", parentId: "tsk789" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskMoveInputSchema = z
  .object({
    id: TaskId.schema.describe("Persistent ID of the task to move."),
    projectId: ProjectId.schema
      .optional()
      .describe("Move into this project. Mutually exclusive with parentId and toInbox."),
    parentId: TaskId.schema
      .optional()
      .describe(
        "Move under this parent task (as a subtask). Mutually exclusive with projectId and toInbox.",
      ),
    toInbox: z
      .literal(true)
      .optional()
      .describe(
        "Set to true to move the task to the inbox (clear any project or parent). Mutually exclusive with projectId and parentId.",
      ),
  })
  .describe(
    "Exactly one of projectId, parentId, or toInbox must be set. Any other combination returns a ValidationError.",
  );

export type TaskMoveToolInput = z.infer<typeof taskMoveInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskMoveContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /**
   * Optional cache; when supplied, `invalidateTaskMutation` flushes scopes
   * for BOTH the source project (pre-move) and the destination project
   * (post-move) so no stale task-list / project detail response survives.
   */
  cache?: InvalidatingCache;
}

/**
 * Pure handler for `task_move`.
 *
 * Validates that exactly one of `projectId`, `parentId`, `toInbox` is set;
 * resolves the destination, pre-fetches the current task to capture its old
 * project for cache invalidation, and delegates to `adapter.moveTask`.
 * Idempotent: returns `{ noChange: true, id, at }` when the task already
 * sits at the requested destination.
 *
 * @throws {ValidationError} when zero or more than one destination is set
 * @throws {NotFound} when the task, target project, or parent does not exist
 */
export async function handleTaskMove(input: TaskMoveToolInput, ctx: TaskMoveContext) {
  const destCount =
    (input.projectId !== undefined ? 1 : 0) +
    (input.parentId !== undefined ? 1 : 0) +
    (input.toInbox === true ? 1 : 0);
  if (destCount !== 1) {
    throw new ValidationError("task_move requires exactly one of projectId, parentId, or toInbox", {
      details: { field: "projectId|parentId|toInbox", provided: destCount },
      suggestion: "Set exactly one destination field — see tool schema.",
    });
  }

  const task = await ctx.adapter.getTask(input.id);

  // Idempotency: already at destination?
  const alreadyAtProject =
    input.projectId !== undefined && task.projectId === input.projectId && task.parentId === null;
  const alreadyAtParent =
    input.parentId !== undefined && task.parentId === input.parentId && task.projectId === null;
  const alreadyInInbox =
    input.toInbox === true && task.projectId === null && task.parentId === null;

  if (alreadyAtProject || alreadyAtParent || alreadyInInbox) {
    return ok(
      {
        noChange: true as const,
        id: input.id,
        at: describeLocation(task.projectId, task.parentId),
      },
      ctx.makeMeta(),
    );
  }

  const from = describeLocation(task.projectId, task.parentId);

  // `toInbox: true` is expressed to the adapter as "no projectId, no parentId"
  // (the adapter's moveTask clears both when neither is supplied).
  const destination =
    input.projectId !== undefined
      ? { projectId: input.projectId }
      : input.parentId !== undefined
        ? { parentId: input.parentId }
        : {};

  await ctx.adapter.moveTask(input.id, destination);

  if (ctx.cache !== undefined) {
    // Invalidate under OLD project (task-list cached keys still reference it)
    invalidateTaskMutation(ctx.cache, { taskId: input.id, projectId: task.projectId });
    // And under NEW project if different (avoid double-emit when same or null)
    if (input.projectId !== undefined && input.projectId !== task.projectId) {
      invalidateTaskMutation(ctx.cache, { projectId: input.projectId });
    }
  }

  const to =
    input.toInbox === true
      ? { inbox: true as const }
      : describeLocation(input.projectId ?? null, input.parentId ?? null);

  return ok(
    { moved: true as const, id: input.id, from, to },
    ctx.makeMeta({
      syncPending: true,
      humanReadableSummary: summaryTaskMove(
        task.name,
        input.toInbox === true ? "inbox" : input.projectId != null ? "project" : "parent task",
      ),
    }),
  );
}

function describeLocation(
  projectId: string | null,
  parentId: string | null,
): { inbox: true } | { projectId: string } | { parentId: string } {
  if (parentId !== null) return { parentId };
  if (projectId !== null) return { projectId };
  return { inbox: true };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskMoveTool(server: McpServer, ctx: TaskMoveContext) {
  return server.registerTool(
    "task_move",
    { description: TASK_MOVE_DESCRIPTION, inputSchema: taskMoveInputSchema.shape },
    async (args: TaskMoveToolInput) => {
      const envelope = await handleTaskMove(args, ctx);
      return toolResponse(envelope);
    },
  );
}
