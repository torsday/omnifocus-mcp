/**
 * `project_batch_drop` MCP tool — drop (cancel) many projects in one round trip.
 *
 * Atomic validation + best-effort execution. Single JXA round trip.
 * Dropped projects remain in OmniFocus but are treated as cancelled/inactive.
 *
 * @see src/tools/task/batchDrop.ts — task sibling pattern
 * @see src/domain/batch.ts — BatchOutcome shape
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateProjectMutation } from "../../cache/invalidation.js";
import { ProjectId } from "../../domain/ids.js";
import { summaryBatchDropProjects } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

export const PROJECT_BATCH_DROP_DESCRIPTION =
  "Cancel (drop) many OmniFocus projects in a single JXA round trip. " +
  "Dropped projects remain in OmniFocus but are treated as cancelled/inactive — " +
  "they do not appear in active project lists. Use project_delete for permanent removal. " +
  "Validation is atomic: if any input fails schema, the whole batch is rejected " +
  "before any mutation. Execution is best-effort: each drop succeeds or fails " +
  "independently, and the response reports per-index outcomes. " +
  "Prefer this tool over repeated project_drop calls whenever dropping more than one project. " +
  "Each item is { id }. " +
  "Returns { dropped: [{index, value: projectId}], failed: [{index, errorCode, message}] }. " +
  "Side effects: writes to OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need changes to appear on other devices.";

const singleItemSchema = z.object({
  id: ProjectId.schema.describe("Persistent project ID."),
});

export const projectBatchDropInputSchema = z.object({
  items: z
    .array(singleItemSchema)
    .min(1)
    .describe("Array of { id } items. Must contain at least one item."),
});

export type ProjectBatchDropToolInput = z.infer<typeof projectBatchDropInputSchema>;

export interface ProjectBatchDropContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

export async function handleProjectBatchDrop(
  input: ProjectBatchDropToolInput,
  ctx: ProjectBatchDropContext,
) {
  const outcome = await ctx.adapter.batchDropProjects(input.items.map((it) => ({ id: it.id })));

  if (ctx.cache !== undefined) {
    for (const s of outcome.succeeded) {
      const src = input.items[s.index];
      if (src !== undefined) {
        invalidateProjectMutation(ctx.cache, { projectId: src.id });
      }
    }
  }

  return ok(
    { dropped: outcome.succeeded, failed: outcome.failed },
    ctx.makeMeta({
      syncPending: outcome.succeeded.length > 0,
      humanReadableSummary: summaryBatchDropProjects(outcome.succeeded.length),
    }),
  );
}

export function registerProjectBatchDropTool(server: McpServer, ctx: ProjectBatchDropContext) {
  return server.registerTool(
    "project_batch_drop",
    {
      description: PROJECT_BATCH_DROP_DESCRIPTION,
      inputSchema: projectBatchDropInputSchema.shape,
    },
    async (args: ProjectBatchDropToolInput) => {
      const envelope = await handleProjectBatchDrop(args, ctx);
      return toolResponse(envelope);
    },
  );
}
