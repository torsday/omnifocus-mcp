/**
 * `task_delete_describe` — preview what task_delete would do without mutating.
 *
 * @see src/tools/task/delete.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ChangeRecord } from "../describe/types.js";
import { type TaskDeleteToolInput, taskDeleteInputSchema } from "./delete.js";

export const TASK_DELETE_DESCRIBE_DESCRIPTION =
  "Preview what task_delete would do without making any changes. " +
  "Do NOT use to actually delete a task — use task_delete instead. " +
  "Returns { description, plannedChanges } describing the permanent deletion that would occur. " +
  "No side effects: read-only by contract — never mutates OmniFocus.";

export interface TaskDeleteDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleTaskDeleteDescribe(
  input: TaskDeleteToolInput,
  ctx: TaskDeleteDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  let taskName: string = String(input.id);

  try {
    const task = await ctx.adapter.getTask(input.id);
    taskName = task.name;
  } catch {
    // fall back to ID
  }

  changes.push({ field: "deleted", newValue: "true" });

  const description = `Would permanently delete task '${taskName}' (id: ${input.id}). IRREVERSIBLE.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerTaskDeleteDescribeTool(server: McpServer, ctx: TaskDeleteDescribeContext) {
  return server.registerTool(
    "task_delete_describe",
    { description: TASK_DELETE_DESCRIBE_DESCRIPTION, inputSchema: taskDeleteInputSchema.shape },
    async (args: TaskDeleteToolInput) => {
      const envelope = await handleTaskDeleteDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
