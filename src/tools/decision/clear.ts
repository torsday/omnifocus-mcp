/**
 * `decision_clear` MCP tool — strip a previously-recorded decision-journal
 * entry from a task or project's note (per #485).
 *
 * Idempotent — returns `noChange: true` when no fence was present.
 *
 * @see src/tools/decision/record.ts — companion `decision_record` tool
 * @see src/domain/decisionJournal.ts — fence parser + serializer
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { invalidateProjectMutation, invalidateTaskMutation } from "../../cache/invalidation.js";
import { clearDecision } from "../../domain/decisionJournal.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import { ok, toolResponse } from "../../envelope/index.js";
import type { DecisionContext } from "./record.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const DECISION_CLEAR_DESCRIPTION =
  "Clear the decision-journal entry from a task or project's note. " +
  "Strips only the `decision-journal` fenced block; any other user prose " +
  "and sibling fences (e.g. waiting-on) are preserved. " +
  "Idempotent: returns noChange:true when the target has no decision recorded. " +
  "Do NOT use this to delete the target — prefer task_delete / project_delete. " +
  "Returns { targetKind, targetId, cleared:true } or { targetKind, targetId, noChange:true }. " +
  "Side effects: writes the target's note via task_update / project_update; " +
  "sets meta.syncPending = true. " +
  'Example: { "targetKind": "project", "targetId": "abc" }';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const decisionClearInputSchema = z.object({
  targetKind: z.enum(["task", "project"]).describe("Whether the target is a task or a project."),
  targetId: z.string().min(1).describe("ID of the task or project."),
});

export type DecisionClearInput = z.infer<typeof decisionClearInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleDecisionClear(input: DecisionClearInput, ctx: DecisionContext) {
  if (input.targetKind === "task") {
    const taskId = TaskId.of(input.targetId);
    const task = await ctx.adapter.getTask(taskId);
    const newNote = clearDecision(task.note);
    if (newNote === task.note) {
      return ok(
        { targetKind: "task" as const, targetId: taskId, noChange: true as const },
        ctx.makeMeta(),
      );
    }
    await ctx.adapter.updateTask(taskId, { note: newNote });
    if (ctx.cache !== undefined) {
      invalidateTaskMutation(ctx.cache, { taskId, projectId: task.projectId });
    }
    return ok(
      { targetKind: "task" as const, targetId: taskId, cleared: true as const },
      ctx.makeMeta({ syncPending: true }),
    );
  }

  const projectId = ProjectId.of(input.targetId);
  const project = await ctx.adapter.getProject(projectId);
  const newNote = clearDecision(project.note);
  if (newNote === project.note) {
    return ok(
      { targetKind: "project" as const, targetId: projectId, noChange: true as const },
      ctx.makeMeta(),
    );
  }
  await ctx.adapter.updateProject(projectId, { note: newNote });
  if (ctx.cache !== undefined) {
    invalidateProjectMutation(ctx.cache, { projectId });
  }
  return ok(
    { targetKind: "project" as const, targetId: projectId, cleared: true as const },
    ctx.makeMeta({ syncPending: true }),
  );
}

export function registerDecisionClearTool(server: McpServer, ctx: DecisionContext) {
  return server.registerTool(
    "decision_clear",
    {
      description: DECISION_CLEAR_DESCRIPTION,
      inputSchema: decisionClearInputSchema.shape,
    },
    async (args: DecisionClearInput) => {
      const envelope = await handleDecisionClear(args, ctx);
      return toolResponse(envelope);
    },
  );
}
