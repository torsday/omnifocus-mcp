/**
 * `task_batch_create_describe` — preview what task_batch_create would do without mutating.
 *
 * @see src/tools/task/batchCreate.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { resolveProjectName, resolveTaskName } from "../describe/prose.js";
import type { ChangeRecord } from "../describe/types.js";
import { type TaskBatchCreateToolInput, taskBatchCreateInputBaseSchema } from "./batchCreate.js";

export const TASK_BATCH_CREATE_DESCRIBE_DESCRIPTION =
  "Preview what task_batch_create would do without making any changes. " +
  "Do NOT use to actually create tasks — use task_batch_create instead. " +
  "Returns { description, plannedChanges } summarising all tasks that would be created. " +
  "No side effects: read-only by contract — never mutates OmniFocus. " +
  "Example: dry-run companion — pass the same args you would to the write tool, inspect plannedChanges, then call the write tool once approved.";

export interface TaskBatchCreateDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleTaskBatchCreateDescribe(
  input: TaskBatchCreateToolInput,
  ctx: TaskBatchCreateDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  const summaries: string[] = [];

  for (const item of input.items) {
    let placement: string;
    if (item.projectId !== undefined) {
      const projectName = await resolveProjectName(ctx.adapter, item.projectId);
      placement = `project '${projectName}'`;
    } else if (item.parentTaskId !== undefined) {
      const parentName = await resolveTaskName(ctx.adapter, item.parentTaskId);
      placement = `subtask of '${parentName}'`;
    } else {
      placement = "Inbox";
    }
    summaries.push(`'${item.name}' (${placement})`);
    changes.push({ field: "name", newValue: item.name });
    if (item.projectId !== undefined) {
      changes.push({ field: "projectId", newValue: item.projectId });
    } else if (item.parentTaskId !== undefined) {
      changes.push({ field: "parentTaskId", newValue: item.parentTaskId });
    }
  }

  const description = `Would create ${input.items.length} task${input.items.length === 1 ? "" : "s"}: ${summaries.join(", ")}.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerTaskBatchCreateDescribeTool(
  server: McpServer,
  ctx: TaskBatchCreateDescribeContext,
) {
  return server.registerTool(
    "task_batch_create_describe",
    {
      description: TASK_BATCH_CREATE_DESCRIBE_DESCRIPTION,
      inputSchema: taskBatchCreateInputBaseSchema.shape,
    },
    async (args: TaskBatchCreateToolInput) => {
      const envelope = await handleTaskBatchCreateDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
