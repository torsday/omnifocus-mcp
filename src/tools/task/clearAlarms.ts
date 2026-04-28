/**
 * `task_clear_alarms` MCP tool — remove all alarms/notifications from a task.
 *
 * Companion zero-arg verb to `task_set_alarms`. Equivalent to calling
 * `task_set_alarms` with an empty array, but exposed separately so the tool
 * surface mirrors `task_clear_repetition` and reads naturally in agent traces.
 *
 * @see src/tools/task/setAlarms.ts — companion tool
 * @see DESIGN.md §26 — tool pattern
 * @see #461
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { TaskId } from "../../domain/ids.js";
import { summaryTaskClearAlarms } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_CLEAR_ALARMS_DESCRIPTION =
  "Remove all alarms/notifications from an OmniFocus task. " +
  "After clearing, the task has no scheduled notifications. " +
  "Use task_set_alarms to install a new alarm set. " +
  "Returns the updated task. " +
  "Mutations do not sync automatically — call sync_trigger if cross-device visibility matters. " +
  'Example: task_clear_alarms({ id: "abc123" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskClearAlarmsInputSchema = z.object({
  id: TaskId.schema.describe("ID of the task to update. Get from task_list or search_query."),
});

export type TaskClearAlarmsInput = z.infer<typeof taskClearAlarmsInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskClearAlarmsContext {
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
export async function handleTaskClearAlarms(
  input: TaskClearAlarmsInput,
  ctx: TaskClearAlarmsContext,
) {
  await ctx.adapter.clearTaskAlarms(input.id);
  const task = await ctx.adapter.getTask(input.id);
  if (ctx.cache !== undefined) {
    invalidateTaskMutation(ctx.cache, { taskId: input.id, projectId: task.projectId });
  }
  const meta = ctx.makeMeta({
    syncPending: true,
    humanReadableSummary: summaryTaskClearAlarms(task.name),
  });
  return ok({ task }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskClearAlarmsTool(server: McpServer, ctx: TaskClearAlarmsContext) {
  return server.registerTool(
    "task_clear_alarms",
    {
      description: TASK_CLEAR_ALARMS_DESCRIPTION,
      inputSchema: taskClearAlarmsInputSchema.shape,
    },
    async (args: TaskClearAlarmsInput) => {
      const envelope = await handleTaskClearAlarms(args, ctx);
      return toolResponse(envelope);
    },
  );
}
