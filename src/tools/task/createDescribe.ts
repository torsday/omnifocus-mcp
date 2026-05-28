/**
 * `task_create_describe` — preview what task_create would do without mutating.
 *
 * @see src/tools/task/create.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { truncateCodePoints } from "../../domain/text.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import {
  formatDate,
  resolveProjectName,
  resolveTagName,
  resolveTaskName,
} from "../describe/prose.js";
import type { ChangeRecord } from "../describe/types.js";
import { type TaskCreateToolInput, taskCreateInputBaseSchema } from "./create.js";

export const TASK_CREATE_DESCRIBE_DESCRIPTION =
  "Preview what task_create would do without making any changes. " +
  "Do NOT use to actually create a task — use task_create instead. " +
  "Returns { description, plannedChanges } describing the task that would be created. " +
  "No side effects: read-only by contract — never mutates OmniFocus. " +
  "Example: dry-run companion — pass the same args you would to the write tool, inspect plannedChanges, then call the write tool once approved.";

export interface TaskCreateDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleTaskCreateDescribe(
  input: TaskCreateToolInput,
  ctx: TaskCreateDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  const parts: string[] = [];

  changes.push({ field: "name", newValue: input.name });
  parts.push(`'${input.name}'`);

  if (input.projectId !== undefined) {
    const projectName = await resolveProjectName(ctx.adapter, input.projectId);
    changes.push({ field: "projectId", newValue: input.projectId });
    parts.push(`in project '${projectName}'`);
  } else if (input.parentTaskId !== undefined) {
    const parentName = await resolveTaskName(ctx.adapter, input.parentTaskId);
    changes.push({ field: "parentTaskId", newValue: input.parentTaskId });
    parts.push(`as subtask of '${parentName}'`);
  } else {
    parts.push("in Inbox");
  }

  if (input.dueDate !== undefined) {
    changes.push({ field: "dueDate", newValue: input.dueDate });
    parts.push(`due ${formatDate(input.dueDate)}`);
  }
  if (input.deferDate !== undefined) {
    changes.push({ field: "deferDate", newValue: input.deferDate });
    parts.push(`deferred until ${formatDate(input.deferDate)}`);
  }
  if (input.flagged === true) {
    changes.push({ field: "flagged", newValue: "true" });
    parts.push("flagged");
  }
  if (input.estimatedMinutes !== undefined) {
    changes.push({ field: "estimatedMinutes", newValue: String(input.estimatedMinutes) });
    parts.push(`estimated ${input.estimatedMinutes} min`);
  }
  if (input.tagIds !== undefined && input.tagIds.length > 0) {
    const tagNames = await Promise.all(input.tagIds.map((id) => resolveTagName(ctx.adapter, id)));
    changes.push({ field: "tagIds", newValue: input.tagIds.join(",") });
    parts.push(`tagged ${tagNames.map((n) => `'${n}'`).join(", ")}`);
  }
  if (input.note !== undefined) {
    changes.push({ field: "note", newValue: truncateCodePoints(input.note, 50) });
  }

  const description = `Would create task ${parts.join(", ")}.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerTaskCreateDescribeTool(server: McpServer, ctx: TaskCreateDescribeContext) {
  return server.registerTool(
    "task_create_describe",
    { description: TASK_CREATE_DESCRIBE_DESCRIPTION, inputSchema: taskCreateInputBaseSchema.shape },
    async (args: TaskCreateToolInput) => {
      const envelope = await handleTaskCreateDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
