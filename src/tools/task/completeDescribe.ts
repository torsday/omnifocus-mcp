/**
 * `task_complete_describe` — preview what task_complete would do without mutating.
 *
 * @see src/tools/task/complete.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ChangeRecord } from "../describe/types.js";
import { type TaskCompleteToolInput, taskCompleteInputSchema } from "./complete.js";

export const TASK_COMPLETE_DESCRIBE_DESCRIPTION =
  "Preview what task_complete would do without making any changes. " +
  "Do NOT use to actually complete a task — use task_complete instead. " +
  "Returns { description, plannedChanges } describing the completion that would occur. " +
  "No side effects: read-only by contract — never mutates OmniFocus.";

export interface TaskCompleteDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleTaskCompleteDescribe(
  input: TaskCompleteToolInput,
  ctx: TaskCompleteDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  let taskName: string = String(input.id);
  let alreadyDone = false;

  try {
    const task = await ctx.adapter.getTask(input.id);
    taskName = task.name;
    alreadyDone = task.completed;
  } catch {
    // fall back to ID
  }

  if (alreadyDone) {
    const description = `Task '${taskName}' is already completed — would be a no-op.`;
    return ok({ description, plannedChanges: changes }, ctx.makeMeta());
  }

  changes.push({ field: "completed", newValue: "true", oldValue: "false" });
  if (input.at !== undefined) {
    changes.push({ field: "completedAt", newValue: input.at });
  }

  const atClause = input.at !== undefined ? ` at ${input.at}` : "";
  const description = `Would mark task '${taskName}' as done${atClause}.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerTaskCompleteDescribeTool(
  server: McpServer,
  ctx: TaskCompleteDescribeContext,
) {
  return server.registerTool(
    "task_complete_describe",
    {
      description: TASK_COMPLETE_DESCRIBE_DESCRIPTION,
      inputSchema: taskCompleteInputSchema.shape,
    },
    async (args: TaskCompleteToolInput) => {
      const envelope = await handleTaskCompleteDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
