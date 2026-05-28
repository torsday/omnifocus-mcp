/**
 * `task_update_describe` — preview what task_update would do without mutating.
 *
 * @see src/tools/task/update.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { truncateCodePoints } from "../../domain/text.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { formatDate, resolveTagName } from "../describe/prose.js";
import type { ChangeRecord } from "../describe/types.js";
import { type TaskUpdateToolInput, taskUpdateInputBaseSchema } from "./update.js";

export const TASK_UPDATE_DESCRIBE_DESCRIPTION =
  "Preview what task_update would do without making any changes. " +
  "Do NOT use to actually update a task — use task_update instead. " +
  "Returns { description, plannedChanges } showing the fields that would be patched. " +
  "No side effects: read-only by contract — never mutates OmniFocus. " +
  "Example: dry-run companion — pass the same args you would to the write tool, inspect plannedChanges, then call the write tool once approved.";

export interface TaskUpdateDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleTaskUpdateDescribe(
  input: TaskUpdateToolInput,
  ctx: TaskUpdateDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  const parts: string[] = [];

  let currentName: string = String(input.id);
  try {
    const task = await ctx.adapter.getTask(input.id);
    currentName = task.name;

    if (input.name !== undefined) {
      changes.push({ field: "name", newValue: input.name, oldValue: task.name });
      parts.push(`rename to '${input.name}'`);
    }
    if (input.dueDate !== undefined) {
      changes.push({
        field: "dueDate",
        newValue: input.dueDate,
        oldValue: task.dueDate ?? null,
      });
      parts.push(
        input.dueDate === null ? "clear due date" : `set due date to ${formatDate(input.dueDate)}`,
      );
    }
    if (input.deferDate !== undefined) {
      changes.push({
        field: "deferDate",
        newValue: input.deferDate,
        oldValue: task.deferDate ?? null,
      });
      parts.push(
        input.deferDate === null
          ? "clear defer date"
          : `set defer date to ${formatDate(input.deferDate)}`,
      );
    }
    const resolvedFlagged = input.setFlagged !== undefined ? input.setFlagged : input.flagged;
    if (resolvedFlagged !== undefined) {
      changes.push({
        field: "flagged",
        newValue: String(resolvedFlagged),
        oldValue: String(task.flagged),
      });
      parts.push(resolvedFlagged ? "flag" : "unflag");
    }
    if (input.estimatedMinutes !== undefined) {
      changes.push({
        field: "estimatedMinutes",
        newValue: input.estimatedMinutes === null ? null : String(input.estimatedMinutes),
        oldValue: task.estimatedMinutes != null ? String(task.estimatedMinutes) : null,
      });
      parts.push(
        input.estimatedMinutes === null
          ? "clear estimated minutes"
          : `set estimated minutes to ${input.estimatedMinutes}`,
      );
    }
    if (input.tagIds !== undefined) {
      const tagNames = await Promise.all(input.tagIds.map((id) => resolveTagName(ctx.adapter, id)));
      changes.push({ field: "tagIds", newValue: input.tagIds.join(",") });
      parts.push(`set tags to [${tagNames.map((n) => `'${n}'`).join(", ")}]`);
    } else if (input.addTags !== undefined || input.removeTags !== undefined) {
      if (input.addTags !== undefined && input.addTags.length > 0) {
        const names = await Promise.all(input.addTags.map((id) => resolveTagName(ctx.adapter, id)));
        changes.push({ field: "addTags", newValue: input.addTags.join(",") });
        parts.push(`add tags [${names.map((n) => `'${n}'`).join(", ")}]`);
      }
      if (input.removeTags !== undefined && input.removeTags.length > 0) {
        const names = await Promise.all(
          input.removeTags.map((id) => resolveTagName(ctx.adapter, id)),
        );
        changes.push({ field: "removeTags", newValue: input.removeTags.join(",") });
        parts.push(`remove tags [${names.map((n) => `'${n}'`).join(", ")}]`);
      }
    }
    if (input.note !== undefined) {
      changes.push({
        field: "note",
        newValue: input.note === null ? null : truncateCodePoints(input.note, 50),
      });
      parts.push(input.note === null ? "clear note" : "update note");
    }
  } catch {
    // adapter unavailable — describe without old values
    if (input.name !== undefined) {
      changes.push({ field: "name", newValue: input.name });
      parts.push(`rename to '${input.name}'`);
    }
  }

  const description =
    parts.length > 0
      ? `Would update task '${currentName}': ${parts.join(", ")}.`
      : `Would update task '${currentName}' (no fields changed).`;

  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerTaskUpdateDescribeTool(server: McpServer, ctx: TaskUpdateDescribeContext) {
  return server.registerTool(
    "task_update_describe",
    { description: TASK_UPDATE_DESCRIBE_DESCRIPTION, inputSchema: taskUpdateInputBaseSchema.shape },
    async (args: TaskUpdateToolInput) => {
      const envelope = await handleTaskUpdateDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
