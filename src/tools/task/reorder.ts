/**
 * `task_reorder` MCP tool — position a task within its parent.
 *
 * Sibling ordering in OmniFocus is expressed relative to another task
 * (`before` / `after`) or as absolute start/end of an explicit container
 * (`at: "start" | "end"` plus `in`). See `TaskPosition` on the adapter.
 *
 * @see src/adapter/OmniFocusAdapter.ts — reorderTask / TaskPosition
 * @see src/tools/task/move.ts (analog)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter, TaskPosition } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import { summaryTaskReorder } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_REORDER_DESCRIPTION =
  "Reorder an OmniFocus task among its siblings. OmniFocus has no numeric " +
  "sibling index — position is always expressed relative to another task " +
  "(before / after) or as the absolute start / end of a container. " +
  "Do NOT use task_reorder to reparent a task to a different project or parent " +
  "(task_move handles reparenting); prefer task_move when the task needs to " +
  "change containers without caring about sibling order. " +
  "Exactly one positioning form must be set: { before }, { after }, or " +
  "{ at, in }. Returns { reordered: true, id, position }. " +
  "Side effects: changes sibling order in OmniFocus, sets meta.syncPending = true. " +
  'Example: task_reorder({ id: "abc123", before: "abc456" }) ' +
  'Example: task_reorder({ id: "abc123", at: "start", in: { projectId: "prj456" } })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const containerSchema = z
  .union([
    z.object({ projectId: ProjectId.schema }),
    z.object({ parentId: TaskId.schema }),
    z.object({ inbox: z.literal(true) }),
  ])
  .describe(
    "Container for start/end positioning. Exactly one of projectId, parentId, or inbox: true.",
  );

export const taskReorderInputSchema = z
  .object({
    id: TaskId.schema.describe("Persistent ID of the task to reorder."),
    before: TaskId.schema
      .optional()
      .describe(
        "Position the task immediately before this sibling. Reference must share the same parent.",
      ),
    after: TaskId.schema
      .optional()
      .describe(
        "Position the task immediately after this sibling. Reference must share the same parent.",
      ),
    at: z
      .enum(["start", "end"])
      .optional()
      .describe("Absolute position within a container. Requires `in` to identify the container."),
    in: containerSchema.optional().describe("Required when `at` is set; ignored otherwise."),
  })
  .describe(
    "Exactly one positioning form: { before }, { after }, or { at, in }. Any other combination returns a ValidationError.",
  );

export type TaskReorderToolInput = z.infer<typeof taskReorderInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskReorderContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /** Optional cache; invalidated for both source and destination project scope. */
  cache?: InvalidatingCache;
}

/**
 * Pure handler for `task_reorder`.
 *
 * Validates that exactly one positioning form is set, resolves it into a
 * `TaskPosition`, and delegates to `adapter.reorderTask`. The source project
 * is captured before the call for cache invalidation.
 *
 * @throws {ValidationError} when zero or multiple positioning forms are set
 * @throws {NotFound} when the task, reference, or container does not exist
 */
export async function handleTaskReorder(input: TaskReorderToolInput, ctx: TaskReorderContext) {
  const formCount =
    (input.before !== undefined ? 1 : 0) +
    (input.after !== undefined ? 1 : 0) +
    (input.at !== undefined ? 1 : 0);
  if (formCount !== 1) {
    throw new ValidationError(
      "task_reorder requires exactly one positioning form: { before }, { after }, or { at, in }",
      {
        details: { field: "before|after|at", provided: formCount },
        suggestion: "Set exactly one positioning field.",
      },
    );
  }
  if (input.at !== undefined && input.in === undefined) {
    throw new ValidationError("task_reorder: `in` is required when `at` is set", {
      details: { field: "in" },
      suggestion: "Provide `in: { projectId } | { parentId } | { inbox: true }`.",
    });
  }
  if (input.at === undefined && input.in !== undefined) {
    throw new ValidationError("task_reorder: `in` is only valid alongside `at`", {
      details: { field: "in" },
      suggestion: "Either add `at: 'start' | 'end'` or remove `in`.",
    });
  }

  const task = await ctx.adapter.getTask(input.id);
  const sourceProjectId = task.projectId;

  let position: TaskPosition;
  if (input.before !== undefined) {
    position = { before: input.before };
  } else if (input.after !== undefined) {
    position = { after: input.after };
  } else if (input.at !== undefined && input.in !== undefined) {
    position = { at: input.at, in: input.in };
  } else {
    // Unreachable — the exactly-one-form and at↔in pairing checks above ensure
    // we land on before, after, or the {at, in} pair. The compiler can't prove
    // it because the guards are on separate fields; the throw keeps types sound.
    throw new ValidationError("task_reorder: no positioning form matched", {
      details: { field: "before|after|at" },
    });
  }

  await ctx.adapter.reorderTask(input.id, position);

  if (ctx.cache !== undefined) {
    invalidateTaskMutation(ctx.cache, { taskId: input.id, projectId: sourceProjectId });
    // For { at, in: { projectId } } the destination container may differ from
    // the source; invalidate that scope too.
    if (input.at !== undefined && input.in !== undefined && "projectId" in input.in) {
      if (input.in.projectId !== sourceProjectId) {
        invalidateTaskMutation(ctx.cache, { projectId: input.in.projectId });
      }
    }
  }

  return ok(
    { reordered: true as const, id: input.id, position },
    ctx.makeMeta({ syncPending: true, humanReadableSummary: summaryTaskReorder(task.name) }),
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskReorderTool(server: McpServer, ctx: TaskReorderContext) {
  return server.registerTool(
    "task_reorder",
    { description: TASK_REORDER_DESCRIPTION, inputSchema: taskReorderInputSchema.shape },
    async (args: TaskReorderToolInput) => {
      const envelope = await handleTaskReorder(args, ctx);
      return toolResponse(envelope);
    },
  );
}
