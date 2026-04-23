/**
 * `task_delete` MCP tool — hard (unrecoverable) removal of an OmniFocus task.
 *
 * This is a destructive, irreversible operation. OmniFocus's `deleteObject`
 * API permanently removes the task from the database with no undo. Prefer
 * `task_drop` when you want a recoverable status change that keeps the task
 * accessible in the database.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/tools/task/update.ts — task_update (patch editable fields)
 * @see docs/domain-reference.md — drop vs. delete distinction
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { TaskId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_DELETE_DESCRIPTION =
  "Permanently delete an OmniFocus task. " +
  "IRREVERSIBLE — uses OmniFocus deleteObject; there is no undo. " +
  "Prefer task_drop when you want a recoverable status change. " +
  "Only use task_delete when the agent has explicit user intent to permanently remove the task. " +
  "Returns { deleted: true, id } on success. " +
  "Side effects: removes the task from OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need the deletion to appear on other devices.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskDeleteInputSchema = z.object({
  id: TaskId.schema.describe(
    "Persistent ID of the task to delete. Get from task_list or search_query. " +
      "Verify you have the correct ID before calling — this action is irreversible.",
  ),
});

export type TaskDeleteToolInput = z.infer<typeof taskDeleteInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskDeleteContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `task_delete`.
 *
 * Delegates to `adapter.deleteTask` which handles cache invalidation and
 * raises `NotFound` for an unknown ID.
 *
 * @throws {NotFound} when the task ID does not exist in OmniFocus
 * @throws {OmniFocusNotRunning} when OmniFocus is not running
 */
export async function handleTaskDelete(input: TaskDeleteToolInput, ctx: TaskDeleteContext) {
  await ctx.adapter.deleteTask(input.id);
  return ok({ deleted: true as const, id: input.id }, ctx.makeMeta({ syncPending: true }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskDeleteTool(server: McpServer, ctx: TaskDeleteContext) {
  return server.registerTool(
    "task_delete",
    { description: TASK_DELETE_DESCRIPTION, inputSchema: taskDeleteInputSchema.shape },
    async (args: TaskDeleteToolInput) => {
      const envelope = await handleTaskDelete(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
