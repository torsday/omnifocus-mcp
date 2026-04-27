/**
 * `task_drop_describe` — preview what task_drop would do without mutating.
 *
 * @see src/tools/task/drop.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ChangeRecord } from "../describe/types.js";
import { type TaskDropToolInput, taskDropInputSchema } from "./drop.js";

export const TASK_DROP_DESCRIBE_DESCRIPTION =
  "Preview what task_drop would do without making any changes. " +
  "Do NOT use to actually drop a task — use task_drop instead. " +
  "Returns { description, plannedChanges } describing the drop that would occur. " +
  "No side effects: read-only by contract — never mutates OmniFocus.";

export interface TaskDropDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleTaskDropDescribe(
  input: TaskDropToolInput,
  ctx: TaskDropDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  let taskName: string = String(input.id);
  let alreadyDropped = false;

  try {
    const task = await ctx.adapter.getTask(input.id);
    taskName = task.name;
    alreadyDropped = task.dropped;
  } catch {
    // fall back to ID
  }

  if (alreadyDropped) {
    const description = `Task '${taskName}' is already dropped — would be a no-op.`;
    return ok({ description, plannedChanges: changes }, ctx.makeMeta());
  }

  changes.push({ field: "dropped", newValue: "true", oldValue: "false" });
  if (input.at !== undefined) {
    changes.push({ field: "droppedAt", newValue: input.at });
  }

  const atClause = input.at !== undefined ? ` at ${input.at}` : "";
  const description = `Would drop task '${taskName}' (mark as dropped/on-hold)${atClause}.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerTaskDropDescribeTool(server: McpServer, ctx: TaskDropDescribeContext) {
  return server.registerTool(
    "task_drop_describe",
    { description: TASK_DROP_DESCRIBE_DESCRIPTION, inputSchema: taskDropInputSchema.shape },
    async (args: TaskDropToolInput) => {
      const envelope = await handleTaskDropDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
