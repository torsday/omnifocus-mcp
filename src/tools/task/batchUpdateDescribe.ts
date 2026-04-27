/**
 * `task_batch_update_describe` — preview what task_batch_update would do without mutating.
 *
 * @see src/tools/task/batchUpdate.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ChangeRecord } from "../describe/types.js";
import { type TaskBatchUpdateToolInput, taskBatchUpdateInputBaseSchema } from "./batchUpdate.js";

export const TASK_BATCH_UPDATE_DESCRIBE_DESCRIPTION =
  "Preview what task_batch_update would do without making any changes. " +
  "Do NOT use to actually update tasks — use task_batch_update instead. " +
  "Returns { description, plannedChanges } summarising all patches that would be applied. " +
  "No side effects: read-only by contract — never mutates OmniFocus.";

export interface TaskBatchUpdateDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleTaskBatchUpdateDescribe(
  input: TaskBatchUpdateToolInput,
  ctx: TaskBatchUpdateDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  const summaries: string[] = [];

  for (const item of input.items) {
    let taskName: string = String(item.id);
    try {
      const task = await ctx.adapter.getTask(item.id);
      taskName = task.name;
    } catch {
      // fall back to ID
    }
    const fields = Object.keys(item.patch).join(", ");
    summaries.push(`'${taskName}' [${fields}]`);
    for (const [field, value] of Object.entries(item.patch)) {
      changes.push({
        field: `${item.id}.${field}`,
        newValue: value === null ? null : String(value),
      });
    }
  }

  const description = `Would update ${input.items.length} task${input.items.length === 1 ? "" : "s"}: ${summaries.join(", ")}.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerTaskBatchUpdateDescribeTool(
  server: McpServer,
  ctx: TaskBatchUpdateDescribeContext,
) {
  return server.registerTool(
    "task_batch_update_describe",
    {
      description: TASK_BATCH_UPDATE_DESCRIBE_DESCRIPTION,
      inputSchema: taskBatchUpdateInputBaseSchema.shape,
    },
    async (args: TaskBatchUpdateToolInput) => {
      const envelope = await handleTaskBatchUpdateDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
