/**
 * `task_batch_move` MCP tool — move many tasks to new destinations in one round trip.
 *
 * Atomic validation + best-effort execution. Single OmniJS round trip.
 * Routes through OmniJS (not JXA) because JXA task.move() is unimplemented
 * in OmniFocus 4.x (error 9 "Replacement not supported currently").
 *
 * @see src/tools/task/batchComplete.ts — sibling pattern
 * @see src/scripts/omnijs/task_batch_move.js — OmniJS implementation
 * @see docs/adr/0002-omnifocus-transport-dual.md — JXA/OmniJS split rationale
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import { summaryBatchMove } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

export const TASK_BATCH_MOVE_DESCRIPTION =
  "Move many OmniFocus tasks to new destinations in a single OmniJS round trip. " +
  "Routes through OmniJS — not JXA — because JXA task.move() is unimplemented in OmniFocus 4.x. " +
  "Each item specifies a task ID and exactly one destination: projectId (move into a project) " +
  "or parentId (move under a parent task). Omit both to move to the inbox. " +
  "Validation is atomic: if any input fails schema, the whole batch is rejected " +
  "before any mutation. Execution is best-effort: each move succeeds or fails " +
  "independently, and the response reports per-index outcomes. " +
  "Prefer this tool over repeated task_move calls whenever moving more than one task. " +
  "Returns { moved: [{index, value: { id, name }}], failed: [{index, errorCode, message}] } — value carries the task name so the agent can describe each move without a follow-up read. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need changes to appear on other devices.";

const destinationSchema = z
  .object({
    projectId: ProjectId.schema
      .optional()
      .describe("Move into a project as a top-level action. Mutually exclusive with parentId."),
    parentId: TaskId.schema
      .optional()
      .describe("Move under a parent task. Mutually exclusive with projectId."),
  })
  .refine((d) => !(d.projectId !== undefined && d.parentId !== undefined), {
    message: "Provide projectId OR parentId, not both",
  });

const singleItemSchema = z.object({
  id: TaskId.schema.describe("Persistent task ID."),
  destination: destinationSchema.describe(
    "Where to move the task. Provide projectId, parentId, or neither (inbox).",
  ),
});

export const taskBatchMoveInputSchema = z.object({
  items: z
    .array(singleItemSchema)
    .min(1)
    .describe("Array of { id, destination } items. Must contain at least one item."),
});

export type TaskBatchMoveToolInput = z.infer<typeof taskBatchMoveInputSchema>;

export interface TaskBatchMoveContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleTaskBatchMove(
  input: TaskBatchMoveToolInput,
  ctx: TaskBatchMoveContext,
) {
  // Pre-fetch all task names in a single round trip — see batchComplete (#594/#597 lever 4).
  const ids = input.items.map((it) => it.id);
  const tasks = await ctx.adapter.getTasksMany(ids);
  const nameById = new Map<string, string>();
  for (let i = 0; i < ids.length; i++) {
    const task = tasks[i];
    if (task !== null && task !== undefined) {
      nameById.set(ids[i] as string, task.name);
    }
  }

  const outcome = await ctx.adapter.batchMoveTasks(
    input.items.map((it) => ({
      id: it.id,
      destination: {
        ...(it.destination.projectId !== undefined && { projectId: it.destination.projectId }),
        ...(it.destination.parentId !== undefined && { parentId: it.destination.parentId }),
      },
    })),
  );

  if (ctx.cache !== undefined) {
    for (const s of outcome.succeeded) {
      const src = input.items[s.index];
      if (src !== undefined) {
        invalidateTaskMutation(ctx.cache, { taskId: src.id });
      }
    }
  }

  const moved = outcome.succeeded.map((s) => ({
    index: s.index,
    value: { id: s.value, name: nameById.get(s.value as string) ?? "" },
  }));

  return ok(
    { moved, failed: outcome.failed },
    ctx.makeMeta({
      syncPending: outcome.succeeded.length > 0,
      humanReadableSummary: summaryBatchMove(outcome.succeeded.length, "destination"),
    }),
  );
}

export function registerTaskBatchMoveTool(server: McpServer, ctx: TaskBatchMoveContext) {
  return server.registerTool(
    "task_batch_move",
    {
      description: TASK_BATCH_MOVE_DESCRIPTION,
      inputSchema: taskBatchMoveInputSchema.shape,
    },
    async (args: TaskBatchMoveToolInput) => {
      const envelope = await handleTaskBatchMove(args, ctx);
      return toolResponse(envelope);
    },
  );
}
