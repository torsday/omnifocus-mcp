/**
 * `decision_record` MCP tool — record agent memory of user judgment on a task
 * or project (per #485).
 *
 * When `project_health` (or any agent-driven scan) flags an anomaly and the
 * user replies "that's deliberate," the agent can record the judgment as a
 * fenced `decision-journal` block in the target's note. Future scans honor
 * the decision until it's cleared or its `until` expiry passes.
 *
 * @see src/domain/decisionJournal.ts — parser + serializer
 * @see src/tools/decision/clear.ts — companion `decision_clear` tool
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import {
  type InvalidatingCache,
  invalidateProjectMutation,
  invalidateTaskMutation,
} from "../../cache/invalidation.js";
import { DECISION_KINDS, type Decision, writeDecision } from "../../domain/decisionJournal.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const DECISION_RECORD_DESCRIPTION =
  "Record agent memory of user judgment on a task or project — kind, reason, " +
  "and an optional auto-expiry. Writes a `decision-journal` fenced block to the " +
  "target's note (preserving any existing user prose), so future scans " +
  "(e.g. project_health) can honor the decision instead of re-litigating it. " +
  "Discriminates on `targetKind`: 'task' or 'project'. " +
  "Do NOT use this for short-lived state — prefer waiting-on for follow-ups, " +
  "or task_update for routine field changes. " +
  "Returns { targetKind, targetId, decision } with the persisted entry. " +
  "Side effects: writes the target's note via task_update / project_update; " +
  "sets meta.syncPending = true. " +
  'Example: { "targetKind": "project", "targetId": "abc", "decision": ' +
  '{ "kind": "stall-is-intentional", "reason": "Strategic pause until Q3" } }';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const decisionInputSchema = z.object({
  kind: z.enum(DECISION_KINDS).describe("The kind of judgment recorded."),
  reason: z.string().min(1).describe("Human-readable reason for the decision."),
  until: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      "Optional ISO-8601 auto-expiry. When set and in the past, the decision is treated " +
        "as expired and downstream consumers re-surface the target.",
    ),
});

export const decisionRecordInputSchema = z.object({
  targetKind: z
    .enum(["task", "project"])
    .describe("Whether the decision attaches to a task or a project."),
  targetId: z
    .string()
    .min(1)
    .describe(
      "ID of the task or project. Must match `targetKind` — agent-side validation, " +
        "but the adapter call surfaces NotFound if the ID is wrong.",
    ),
  decision: decisionInputSchema.describe(
    "The decision payload. `recordedAt` is set automatically on write.",
  ),
});

export type DecisionRecordInput = z.infer<typeof decisionRecordInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface DecisionContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
  /** Inject `now` for tests; defaults to wall clock. */
  now?: () => Date;
}

export async function handleDecisionRecord(input: DecisionRecordInput, ctx: DecisionContext) {
  const now = ctx.now ? ctx.now() : new Date();
  const decision: Decision = {
    kind: input.decision.kind,
    reason: input.decision.reason,
    recordedAt: now.toISOString(),
    ...(input.decision.until !== undefined && { until: input.decision.until }),
  };

  if (input.targetKind === "task") {
    const taskId = TaskId.of(input.targetId);
    const task = await ctx.adapter.getTask(taskId);
    const newNote = writeDecision(task.note, decision);
    await ctx.adapter.updateTask(taskId, { note: newNote });
    if (ctx.cache !== undefined) {
      invalidateTaskMutation(ctx.cache, { taskId, projectId: task.projectId });
    }
    return ok(
      { targetKind: "task" as const, targetId: taskId, decision },
      ctx.makeMeta({ syncPending: true }),
    );
  }

  const projectId = ProjectId.of(input.targetId);
  const project = await ctx.adapter.getProject(projectId);
  const newNote = writeDecision(project.note, decision);
  await ctx.adapter.updateProject(projectId, { note: newNote });
  if (ctx.cache !== undefined) {
    invalidateProjectMutation(ctx.cache, { projectId });
  }
  return ok(
    { targetKind: "project" as const, targetId: projectId, decision },
    ctx.makeMeta({ syncPending: true }),
  );
}

export function registerDecisionRecordTool(server: McpServer, ctx: DecisionContext) {
  return server.registerTool(
    "decision_record",
    {
      description: DECISION_RECORD_DESCRIPTION,
      inputSchema: decisionRecordInputSchema.shape,
    },
    async (args: DecisionRecordInput) => {
      const envelope = await handleDecisionRecord(args, ctx);
      return toolResponse(envelope);
    },
  );
}
