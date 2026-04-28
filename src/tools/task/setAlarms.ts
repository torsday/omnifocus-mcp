/**
 * `task_set_alarms` MCP tool — atomically replace a task's alarm/notification set.
 *
 * Alarms are OmniFocus's per-task notifications: a relative offset from the
 * task's due or defer date, or an absolute fire time. This tool is full-replace:
 * the supplied list becomes the canonical set, and any existing alarms are
 * dropped. Pass an empty array to clear everything (or use `task_clear_alarms`).
 *
 * Validation enforced here (not at the OmniJS layer):
 *   - `due-relative` requires the task to have a `dueDate`.
 *   - `defer-relative` requires the task to have a `deferDate`.
 *   - `absolute` is unconstrained (the OmniJS layer parses the ISO string).
 *
 * @see DESIGN.md §26 — tool pattern
 * @see src/domain/task.ts — TaskAlarm schema
 * @see src/tools/task/clearAlarms.ts — companion zero-arg verb
 * @see #461
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { TaskId } from "../../domain/ids.js";
import { TaskAlarmSchema } from "../../domain/task.js";
import { summaryTaskSetAlarms } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_SET_ALARMS_DESCRIPTION =
  "Replace the alarm/notification set on an OmniFocus task atomically. " +
  "Pass an array of alarms; this overwrites any existing alarms in full. " +
  "Each alarm is one of: " +
  "{kind:'due-relative', offsetSeconds:N} (positive = before due date, negative = after), " +
  "{kind:'defer-relative', offsetSeconds:N} (relative to defer date), or " +
  "{kind:'absolute', fireAt:ISO-8601 string}. " +
  "Relative kinds require the task to already have the corresponding date set, " +
  "or the call returns a VALIDATION error. " +
  "Use task_clear_alarms to remove all alarms with no payload. " +
  "Returns the updated task. " +
  "Mutations do not sync automatically — call sync_trigger if cross-device visibility matters. " +
  'Example: task_set_alarms({ id: "abc123", alarms: [{ kind: "due-relative", offsetSeconds: 3600 }] }) ' +
  'Example: task_set_alarms({ id: "abc123", alarms: [{ kind: "absolute", fireAt: "2026-05-01T09:00:00Z" }] })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskSetAlarmsInputSchema = z.object({
  id: TaskId.schema.describe("ID of the task to update. Get from task_list or search_query."),
  alarms: z
    .array(TaskAlarmSchema)
    .describe(
      "Full replacement set of alarms. " +
        "Empty array is permitted and equivalent to task_clear_alarms.",
    ),
});

export type TaskSetAlarmsInput = z.infer<typeof taskSetAlarmsInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskSetAlarmsContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /**
   * Optional cache; when supplied, `invalidateTaskMutation` flushes the
   * scopes in the per-mutation matrix after the adapter call succeeds.
   */
  cache?: InvalidatingCache;
}

/**
 * Pure handler — callable directly in unit tests.
 */
export async function handleTaskSetAlarms(input: TaskSetAlarmsInput, ctx: TaskSetAlarmsContext) {
  // Pre-validate anchor presence for relative alarms. We fetch the task once
  // to check its date fields (and surface NotFound) before mutating, so a
  // mixed-validity payload doesn't half-apply.
  const task = await ctx.adapter.getTask(input.id);

  for (const alarm of input.alarms) {
    if (alarm.kind === "due-relative" && task.dueDate === null) {
      throw new ValidationError(
        "Cannot set a due-relative alarm on a task with no dueDate. " +
          "Set the task's due date first, or use an absolute alarm.",
        { details: { field: "alarms", taskId: input.id, alarmKind: alarm.kind } },
      );
    }
    if (alarm.kind === "defer-relative" && task.deferDate === null) {
      throw new ValidationError(
        "Cannot set a defer-relative alarm on a task with no deferDate. " +
          "Set the task's defer date first, or use an absolute alarm.",
        { details: { field: "alarms", taskId: input.id, alarmKind: alarm.kind } },
      );
    }
  }

  await ctx.adapter.setTaskAlarms(input.id, input.alarms);
  const updated = await ctx.adapter.getTask(input.id);
  if (ctx.cache !== undefined) {
    invalidateTaskMutation(ctx.cache, { taskId: input.id, projectId: updated.projectId });
  }
  const meta = ctx.makeMeta({
    syncPending: true,
    humanReadableSummary: summaryTaskSetAlarms(task.name, input.alarms.length),
  });
  return ok({ task: updated }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskSetAlarmsTool(server: McpServer, ctx: TaskSetAlarmsContext) {
  return server.registerTool(
    "task_set_alarms",
    {
      description: TASK_SET_ALARMS_DESCRIPTION,
      inputSchema: taskSetAlarmsInputSchema.shape,
    },
    async (args: TaskSetAlarmsInput) => {
      const envelope = await handleTaskSetAlarms(args, ctx);
      return toolResponse(envelope);
    },
  );
}
