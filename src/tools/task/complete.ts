/**
 * `task_complete` MCP tool — mark an OmniFocus task as done.
 *
 * When the task has incomplete children, returns a `clarification-needed` envelope
 * offering the agent the choice of completing children too or leaving them.
 *
 * @see src/tools/task/uncomplete.ts — reverse operation
 * @see src/tools/task/drop.ts — task_drop (deferred without completing)
 * @see src/tools/task/delete.ts — task_delete (irreversible hard removal)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { finaliseHints, projectEmptyHint } from "../../domain/hints.js";
import { TaskId } from "../../domain/ids.js";
import type { Task } from "../../domain/task.js";
import { summaryTaskComplete } from "../../domain/writeSummary.js";
import { clarificationNeeded, ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { replayStore as defaultReplayStore, type ReplayStore } from "../../state/replayStore.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_COMPLETE_DESCRIPTION =
  "Complete an OmniFocus task — marks it done with a completion timestamp. " +
  "Accepts an optional ISO-8601 date for the completion time; defaults to now. " +
  "Idempotent: returns noChange: true if the task is already completed. " +
  "When the task has incomplete children, returns clarification-needed asking whether " +
  "to complete children too — call the `clarify` tool with the user's choice. " +
  "Do not use to drop or delete a task. " +
  "Returns { done: true, id, name } or { noChange: true, id, name } — name lets the agent describe the change without a follow-up read. " +
  "Side effects: sets completedAt, sets meta.syncPending = true. " +
  'Example: task_complete({ id: "abc123" }) ' +
  'Example: task_complete({ id: "abc123", at: "2026-05-01T09:00:00Z" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskCompleteInputSchema = z.object({
  id: TaskId.schema.describe("Persistent task ID."),
  at: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("ISO-8601 completion time. Defaults to now."),
});

export type TaskCompleteToolInput = z.infer<typeof taskCompleteInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskCompleteContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
  replayStore?: ReplayStore;
}

export async function handleTaskComplete(input: TaskCompleteToolInput, ctx: TaskCompleteContext) {
  const task = await ctx.adapter.getTask(input.id);
  if (task.completed) {
    return ok({ noChange: true as const, id: input.id, name: task.name }, ctx.makeMeta());
  }

  // Check for incomplete children — offer the agent a choice before writing.
  const store = ctx.replayStore ?? defaultReplayStore;
  let incompleteChildren: Task[] = [];
  try {
    incompleteChildren = await ctx.adapter.listTasks({ parentId: input.id, completed: false });
  } catch {
    // Children check failure never blocks the operation — proceed without clarifying.
  }

  if (incompleteChildren.length > 0) {
    const meta = ctx.makeMeta();
    const options = [
      "Complete this task and all incomplete children",
      "Complete this task only — leave children incomplete",
    ];
    const childIds = incompleteChildren.map((c) => c.id);
    const token = store.register(options, async (choice) => {
      return _doComplete(input, task, ctx, choice === 0 ? childIds : []);
    });
    return clarificationNeeded(
      `"${task.name}" has ${incompleteChildren.length} incomplete child task(s). How should they be handled?`,
      token,
      meta,
      options.map((label, index) => ({ index, label })),
      { id: input.id, ...(input.at !== undefined ? { at: input.at } : {}) },
    );
  }

  return _doComplete(input, task, ctx, []);
}

/**
 * Performs the actual OmniFocus write. Optionally completes `childIds` first
 * (best-effort — child failure never aborts the parent completion).
 */
async function _doComplete(
  input: TaskCompleteToolInput,
  task: Task,
  ctx: TaskCompleteContext,
  childIds: TaskId[],
) {
  for (const childId of childIds) {
    try {
      await ctx.adapter.completeTask(childId);
    } catch {
      // Best-effort child completion — don't let a child failure abort the parent.
    }
  }

  const at = input.at !== undefined ? new Date(input.at) : undefined;
  await ctx.adapter.completeTask(input.id, at);
  if (ctx.cache !== undefined) {
    invalidateTaskMutation(ctx.cache, { taskId: input.id, projectId: task.projectId });
  }

  // Hint: if the parent project now has no remaining tasks, suggest completing it.
  let hints: ReturnType<typeof finaliseHints>;
  if (task.projectId !== null) {
    try {
      const remaining = await ctx.adapter.listTasks({
        projectId: task.projectId,
        completed: false,
      });
      if (remaining.length === 0) {
        const project = await ctx.adapter.getProject(task.projectId);
        hints = finaliseHints([projectEmptyHint(task.projectId, project.name)]);
      }
    } catch {
      // Hint fetch failure never blocks the response.
    }
  }

  return ok(
    { done: true as const, id: input.id, name: task.name },
    ctx.makeMeta({ syncPending: true, humanReadableSummary: summaryTaskComplete(task.name) }),
    undefined,
    hints,
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskCompleteTool(server: McpServer, ctx: TaskCompleteContext) {
  return server.registerTool(
    "task_complete",
    { description: TASK_COMPLETE_DESCRIPTION, inputSchema: taskCompleteInputSchema.shape },
    async (args: TaskCompleteToolInput) => {
      const envelope = await handleTaskComplete(args, ctx);
      return toolResponse(envelope);
    },
  );
}
