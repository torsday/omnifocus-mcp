/**
 * `task_convert_to_project` MCP tool — promote a task to a first-class project
 * using OmniJS `Database.convertTasksToProjects()`.
 *
 * The task's persistent identifier is preserved on the resulting project,
 * so any agent holding the task ID can immediately use it as a project ID.
 * Subtasks, notes, tags, and dates are carried over by OmniFocus.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/scripts/omnijs/task_convert_to_project.js — OmniJS implementation
 * @see https://github.com/torsday/omnifocus-mcp/issues/525
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import {
  type InvalidatingCache,
  invalidateProjectMutation,
  invalidateTaskMutation,
} from "../../cache/invalidation.js";
import { FolderId, TaskId } from "../../domain/ids.js";
import { summaryTaskConvertToProject } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_CONVERT_TO_PROJECT_DESCRIPTION =
  "Promote an OmniFocus task to a first-class project via OmniJS " +
  "Database.convertTasksToProjects(). The task's persistent identifier is " +
  "preserved on the resulting project — agents can continue using the same ID " +
  "as a project ID after conversion. Subtasks, notes, tags, and dates are " +
  "carried over by OmniFocus automatically. " +
  "Use this when a task has grown in scope and needs its own review interval, " +
  "subtask hierarchy, or project-level metadata. " +
  "Do NOT use on tasks already in a project — use task_move instead for " +
  "reparenting; use project_create when starting from scratch. " +
  "Returns { converted: true, projectId, taskId, name } — name is the task name (carried over to the new project) so the agent can describe the conversion without a follow-up read. " +
  "Side effects: removes the task from the task list and adds a project; " +
  "sets meta.syncPending = true.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const taskConvertToProjectInputSchema = z.object({
  id: TaskId.schema.describe("Persistent ID of the task to promote."),
  folderId: FolderId.schema
    .optional()
    .describe("Place the new project inside this folder. Omit to place at the top of the library."),
  position: z
    .enum(["beginning", "ending"])
    .optional()
    .describe(
      'Where within the folder or library to insert the new project. Defaults to "ending".',
    ),
});

export type TaskConvertToProjectToolInput = z.infer<typeof taskConvertToProjectInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskConvertToProjectContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

/**
 * Pure handler for `task_convert_to_project`.
 *
 * Delegates to `adapter.convertTaskToProject()` which calls OmniJS
 * `Database.convertTasksToProjects()`. Invalidates both the source task
 * scope and the new project scope so stale cached responses are flushed.
 *
 * @throws {NotFound} when the task or target folder does not exist
 * @throws {ValidationError} when OmniJS rejects the conversion
 */
export async function handleTaskConvertToProject(
  input: TaskConvertToProjectToolInput,
  ctx: TaskConvertToProjectContext,
) {
  const opts: {
    folderId?: import("../../domain/ids.js").FolderId;
    position?: "beginning" | "ending";
  } = {};
  if (input.folderId !== undefined) opts.folderId = input.folderId;
  if (input.position !== undefined) opts.position = input.position;
  const task = await ctx.adapter.getTask(input.id);
  const projectId = await ctx.adapter.convertTaskToProject(input.id, opts);

  if (ctx.cache !== undefined) {
    invalidateTaskMutation(ctx.cache, { taskId: input.id });
    invalidateProjectMutation(ctx.cache, { projectId });
  }

  return ok(
    { converted: true as const, projectId, taskId: input.id, name: task.name },
    ctx.makeMeta({
      syncPending: true,
      humanReadableSummary: summaryTaskConvertToProject(task.name),
    }),
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskConvertToProjectTool(
  server: McpServer,
  ctx: TaskConvertToProjectContext,
) {
  return server.registerTool(
    "task_convert_to_project",
    {
      description: TASK_CONVERT_TO_PROJECT_DESCRIPTION,
      inputSchema: taskConvertToProjectInputSchema.shape,
    },
    async (args: TaskConvertToProjectToolInput) => {
      const envelope = await handleTaskConvertToProject(args, ctx);
      return toolResponse(envelope);
    },
  );
}
