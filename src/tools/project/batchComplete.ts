/**
 * `project_batch_complete` MCP tool — complete many projects in one round trip.
 *
 * Atomic validation + best-effort execution. Single JXA round trip.
 *
 * @see src/tools/task/batchComplete.ts — task sibling pattern
 * @see src/domain/batch.ts — BatchOutcome shape
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateProjectMutation } from "../../cache/invalidation.js";
import { ProjectId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

export const PROJECT_BATCH_COMPLETE_DESCRIPTION =
  "Mark many OmniFocus projects as completed in a single JXA round trip. " +
  "Completed projects are hidden from active views and closed to new task entry. " +
  "Validation is atomic: if any input fails schema, the whole batch is rejected " +
  "before any mutation. Execution is best-effort: each completion succeeds or fails " +
  "independently, and the response reports per-index outcomes. " +
  "Prefer this tool over repeated project_complete calls whenever completing more than one project. " +
  "Each item is { id }. " +
  "Returns { completed: [{index, value: projectId}], failed: [{index, errorCode, message}] }. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need changes to appear on other devices.";

const singleItemSchema = z.object({
  id: ProjectId.schema.describe("Persistent project ID."),
});

export const projectBatchCompleteInputSchema = z.object({
  items: z
    .array(singleItemSchema)
    .min(1)
    .describe("Array of { id } items. Must contain at least one item."),
});

export type ProjectBatchCompleteToolInput = z.infer<typeof projectBatchCompleteInputSchema>;

export interface ProjectBatchCompleteContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleProjectBatchComplete(
  input: ProjectBatchCompleteToolInput,
  ctx: ProjectBatchCompleteContext,
) {
  const outcome = await ctx.adapter.batchCompleteProjects(input.items.map((it) => ({ id: it.id })));

  if (ctx.cache !== undefined) {
    for (const s of outcome.succeeded) {
      const src = input.items[s.index];
      if (src !== undefined) {
        invalidateProjectMutation(ctx.cache, { projectId: src.id });
      }
    }
  }

  return ok(
    { completed: outcome.succeeded, failed: outcome.failed },
    ctx.makeMeta({ syncPending: outcome.succeeded.length > 0 }),
  );
}

export function registerProjectBatchCompleteTool(
  server: McpServer,
  ctx: ProjectBatchCompleteContext,
) {
  return server.registerTool(
    "project_batch_complete",
    {
      description: PROJECT_BATCH_COMPLETE_DESCRIPTION,
      inputSchema: projectBatchCompleteInputSchema.shape,
    },
    async (args: ProjectBatchCompleteToolInput) => {
      const envelope = await handleProjectBatchComplete(args, ctx);
      return toolResponse(envelope);
    },
  );
}
