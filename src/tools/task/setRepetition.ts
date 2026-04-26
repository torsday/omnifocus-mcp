/**
 * `task_set_repetition` MCP tool — atomically set the repetition rule on a task.
 *
 * A dedicated verb for repetition keeps the operation atomic and agent-friendly:
 * agents don't need to read the full task object before patching a single field.
 * `task_clear_repetition` is the complementary zero-arg verb that removes the rule.
 *
 * When the rule is structurally valid but OF rejects it (e.g. the task is
 * completing via children and repetition conflicts), OmniFocus surfaces the
 * rejection as an error — the adapter maps it to `ScriptError`.
 *
 * @see DESIGN.md §26 — tool pattern
 * @see src/domain/task.ts — RepetitionRule schema
 * @see src/tools/task/clearRepetition.ts — companion tool
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { TaskId } from "../../domain/ids.js";
import { RepetitionRuleSchema } from "../../domain/task.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_SET_REPETITION_DESCRIPTION =
  "Set the repetition rule on an OmniFocus task. " +
  "Overwrites any existing rule. Use task_clear_repetition to remove a rule entirely. " +
  "Returns the updated task ID; call task_get for the full object. " +
  "Mutations do not sync automatically — call sync_trigger if cross-device visibility matters.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskSetRepetitionInputSchema = z.object({
  id: TaskId.schema.describe("ID of the task to update. Get from task_list or search_query."),
  rule: RepetitionRuleSchema.describe(
    "Repetition rule to apply. " +
      "'method': 'fixed' repeats from the due date, 'start-again' from completion, 'due-again' from due date (alias). " +
      "'unit': time unit for the interval. " +
      "'steps': how many units between occurrences (minimum 1). " +
      "'weekdays': optional array of day names — only valid when unit is 'weeks'. " +
      "'monthlyAnchor': optional day-of-month or weekday-position — only valid when unit is 'months'.",
  ),
});

export type TaskSetRepetitionInput = z.infer<typeof taskSetRepetitionInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskSetRepetitionContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /**
   * Optional cache; when supplied, `invalidateTaskMutation` flushes the
   * scopes in the per-mutation matrix (docs/cache-invalidation.md) after
   * the adapter call succeeds.
   */
  cache?: InvalidatingCache;
}

/**
 * Pure handler — callable directly in unit tests.
 */
export async function handleTaskSetRepetition(
  input: TaskSetRepetitionInput,
  ctx: TaskSetRepetitionContext,
) {
  await ctx.adapter.updateTask(input.id, { repetition: input.rule });
  const task = await ctx.adapter.getTask(input.id);
  if (ctx.cache !== undefined) {
    invalidateTaskMutation(ctx.cache, { taskId: input.id, projectId: task.projectId });
  }
  const meta = ctx.makeMeta({ syncPending: true });
  return ok({ task }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskSetRepetitionTool(server: McpServer, ctx: TaskSetRepetitionContext) {
  return server.registerTool(
    "task_set_repetition",
    {
      description: TASK_SET_REPETITION_DESCRIPTION,
      inputSchema: taskSetRepetitionInputSchema.shape,
    },
    async (args: TaskSetRepetitionInput) => {
      const envelope = await handleTaskSetRepetition(args, ctx);
      return toolResponse(envelope);
    },
  );
}
