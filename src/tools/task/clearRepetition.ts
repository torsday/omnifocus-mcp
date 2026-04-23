/**
 * `task_clear_repetition` MCP tool — remove the repetition rule from a task.
 *
 * Companion to `task_set_repetition`. Clears the rule atomically without
 * requiring a full task_update payload.
 *
 * @see src/tools/task/setRepetition.ts — companion tool
 * @see DESIGN.md §26 — tool pattern
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { TaskId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_CLEAR_REPETITION_DESCRIPTION =
  "Remove the repetition rule from an OmniFocus task. " +
  "After clearing, the task becomes a one-time item. " +
  "Use task_set_repetition to set or change a rule. " +
  "Mutations do not sync automatically — call sync_trigger if cross-device visibility matters.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskClearRepetitionInputSchema = z.object({
  id: TaskId.schema.describe("ID of the task to update. Get from task_list or search_query."),
});

export type TaskClearRepetitionInput = z.infer<typeof taskClearRepetitionInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskClearRepetitionContext {
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
export async function handleTaskClearRepetition(
  input: TaskClearRepetitionInput,
  ctx: TaskClearRepetitionContext,
) {
  await ctx.adapter.updateTask(input.id, { repetition: null });
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

export function registerTaskClearRepetitionTool(
  server: McpServer,
  ctx: TaskClearRepetitionContext,
) {
  return server.registerTool(
    "task_clear_repetition",
    {
      description: TASK_CLEAR_REPETITION_DESCRIPTION,
      inputSchema: taskClearRepetitionInputSchema.shape,
    },
    async (args: TaskClearRepetitionInput) => {
      const envelope = await handleTaskClearRepetition(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
