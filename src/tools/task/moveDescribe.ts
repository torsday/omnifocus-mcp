/**
 * `task_move_describe` — preview what task_move would do without mutating.
 *
 * @see src/tools/task/move.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { resolveProjectName, resolveTaskName } from "../describe/prose.js";
import type { ChangeRecord } from "../describe/types.js";
import { type TaskMoveToolInput, taskMoveInputSchema } from "./move.js";

export const TASK_MOVE_DESCRIBE_DESCRIPTION =
  "Preview what task_move would do without making any changes. " +
  "Do NOT use to actually move a task — use task_move instead. " +
  "Returns { description, plannedChanges } describing the reparenting that would occur. " +
  "No side effects: read-only by contract — never mutates OmniFocus. " +
  "Example: dry-run companion — pass the same args you would to the write tool, inspect plannedChanges, then call the write tool once approved.";

export interface TaskMoveDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleTaskMoveDescribe(
  input: TaskMoveToolInput,
  ctx: TaskMoveDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  let taskName: string = String(input.id);

  try {
    const task = await ctx.adapter.getTask(input.id);
    taskName = task.name;
  } catch {
    // fall back to ID
  }

  let destDescription: string;

  if (input.projectId !== undefined) {
    const projectName = await resolveProjectName(ctx.adapter, input.projectId);
    changes.push({ field: "projectId", newValue: input.projectId });
    destDescription = `project '${projectName}'`;
  } else if (input.parentId !== undefined) {
    const parentName = await resolveTaskName(ctx.adapter, input.parentId);
    changes.push({ field: "parentId", newValue: input.parentId });
    destDescription = `subtask of '${parentName}'`;
  } else {
    changes.push({ field: "location", newValue: "inbox" });
    destDescription = "Inbox";
  }

  const description = `Would move task '${taskName}' to ${destDescription}.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerTaskMoveDescribeTool(server: McpServer, ctx: TaskMoveDescribeContext) {
  return server.registerTool(
    "task_move_describe",
    { description: TASK_MOVE_DESCRIBE_DESCRIPTION, inputSchema: taskMoveInputSchema.shape },
    async (args: TaskMoveToolInput) => {
      const envelope = await handleTaskMoveDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
