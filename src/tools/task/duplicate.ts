/**
 * `task_duplicate` MCP tool — clone a task, optionally with its full subtask
 * subtree.
 *
 * Editable fields (name, note, dates, flagged, tags, estimatedMinutes,
 * repetition, sequential, completedByChildren) copy across; system fields
 * (id, createdAt, modifiedAt, completedAt, droppedAt) and completed/dropped
 * state are reset — a duplicate is a fresh, active task.
 *
 * By default the clone lands alongside the source (same container). Supply
 * `destination` to override with a project, parent task, or the inbox.
 *
 * @see src/adapter/OmniFocusAdapter.ts — duplicateTask signature
 * @see src/tools/task/move.ts (destination shape analog)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import { summaryTaskDuplicate } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_DUPLICATE_DESCRIPTION =
  "Duplicate an OmniFocus task, optionally including its entire subtask " +
  "subtree when recursive: true. Editable fields copy over (name, note, " +
  "defer/due dates, flagged, tags, estimate, repetition); system fields " +
  "(id, timestamps) regenerate; completed/dropped state is NOT carried — " +
  "the duplicate is a fresh, active task. " +
  "Do NOT use task_duplicate as a substitute for task_move (which reparents " +
  "the existing task) or task_create (when the new task's fields differ from " +
  "the source). " +
  "By default the clone lands alongside the source. Provide destination with " +
  "exactly one of projectId, parentId, or toInbox: true to place it elsewhere. " +
  "Returns { duplicated: true, sourceId, newId, descendantCount, name } — name is the source task's name (the duplicate carries the same name) so the agent can describe the new task without a follow-up read. " +
  "Side effects: creates one new task (plus descendants if recursive) in " +
  "OmniFocus, sets meta.syncPending = true. " +
  'Example: task_duplicate({ id: "abc123" }) ' +
  'Example: task_duplicate({ id: "abc123", recursive: true, destination: { projectId: "prj456" } })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const destinationSchema = z
  .union([
    z.object({ projectId: ProjectId.schema }),
    z.object({ parentId: TaskId.schema }),
    z.object({ toInbox: z.literal(true) }),
  ])
  .describe(
    "Where to place the duplicate. Exactly one of projectId, parentId, or toInbox: true. Omit to clone alongside the source.",
  );

export const taskDuplicateInputSchema = z
  .object({
    id: TaskId.schema.describe("Persistent ID of the task to duplicate."),
    recursive: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, clone the full subtask subtree depth-first. Default: false (clone only the task itself).",
      ),
    destination: destinationSchema.optional(),
  })
  .describe("Duplicate options. `destination` overrides the default same-container placement.");

export type TaskDuplicateToolInput = z.infer<typeof taskDuplicateInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskDuplicateContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /**
   * Optional cache; invalidated for the source project and, when
   * `destination.projectId` differs, the destination project too.
   */
  cache?: InvalidatingCache;
}

/**
 * Pure handler for `task_duplicate`.
 *
 * @throws {ValidationError} when `destination` sets more than one field
 * @throws {NotFound} when the source task or destination container is unknown
 */
export async function handleTaskDuplicate(
  input: TaskDuplicateToolInput,
  ctx: TaskDuplicateContext,
) {
  if (input.destination !== undefined) {
    const d = input.destination;
    const keys =
      ("projectId" in d ? 1 : 0) +
      ("parentId" in d ? 1 : 0) +
      ("toInbox" in d && d.toInbox === true ? 1 : 0);
    if (keys !== 1) {
      throw new ValidationError(
        "task_duplicate: destination must set exactly one of projectId, parentId, or toInbox",
        {
          details: { field: "destination", provided: keys },
          suggestion: "Set exactly one destination field or omit destination entirely.",
        },
      );
    }
  }

  const source = await ctx.adapter.getTask(input.id);

  const { newId, descendantCount } = await ctx.adapter.duplicateTask(input.id, {
    recursive: input.recursive,
    ...(input.destination !== undefined ? { destination: input.destination } : {}),
  });

  if (ctx.cache !== undefined) {
    invalidateTaskMutation(ctx.cache, {
      taskId: newId,
      projectId: source.projectId,
      parentId: source.parentId,
    });
    if (
      input.destination !== undefined &&
      "projectId" in input.destination &&
      input.destination.projectId !== source.projectId
    ) {
      invalidateTaskMutation(ctx.cache, { projectId: input.destination.projectId });
    }
    if (
      input.destination !== undefined &&
      "parentId" in input.destination &&
      input.destination.parentId !== source.parentId
    ) {
      invalidateTaskMutation(ctx.cache, { parentId: input.destination.parentId });
    }
  }

  return ok(
    {
      duplicated: true as const,
      sourceId: input.id,
      newId,
      descendantCount,
      name: source.name,
    },
    ctx.makeMeta({ syncPending: true, humanReadableSummary: summaryTaskDuplicate(source.name) }),
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskDuplicateTool(server: McpServer, ctx: TaskDuplicateContext) {
  return server.registerTool(
    "task_duplicate",
    { description: TASK_DUPLICATE_DESCRIPTION, inputSchema: taskDuplicateInputSchema.shape },
    async (args: TaskDuplicateToolInput) => {
      const envelope = await handleTaskDuplicate(args, ctx);
      return toolResponse(envelope);
    },
  );
}
