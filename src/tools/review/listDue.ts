/**
 * `review_list_due` MCP tool — list projects due for review.
 *
 * @see src/services/reviewService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ReviewService } from "../../services/reviewService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const REVIEW_LIST_DUE_DESCRIPTION =
  "List projects due for review in OmniFocus — those whose next review date is today or earlier, or has never been set. " +
  "Sorted by next review date ascending (overdue first, never-reviewed first). " +
  "Do not use to get all projects; prefer project_list for that. " +
  "Returns each project's id, name, nextReviewDate, lastReviewDate, and reviewIntervalDays. " +
  "Safe to call repeatedly; no side effects, no writes. " +
  "Example: review_list_due()";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const reviewListDueInputSchema = z.object({});

export type ReviewListDueToolInput = z.infer<typeof reviewListDueInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ReviewListDueContext {
  reviewService: ReviewService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleReviewListDue(
  _input: ReviewListDueToolInput,
  ctx: ReviewListDueContext,
) {
  const result = await ctx.reviewService.listDue();
  const meta = ctx.makeMeta({ cacheHit: result.cacheHit });
  // Project to the documented 5 fields only — full Project[] shape carries
  // noteHtml, taskCount, completedTaskCount, etc. that inflate token cost
  // without adding review-workflow value. Use project_get for heavy fields.
  const projects = result.projects.map((p) => ({
    id: p.id,
    name: p.name,
    nextReviewDate: p.nextReviewDate,
    lastReviewDate: p.lastReviewDate,
    reviewIntervalDays: p.reviewIntervalDays,
  }));
  return ok({ projects }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerReviewListDueTool(server: McpServer, ctx: ReviewListDueContext) {
  return server.registerTool(
    "review_list_due",
    {
      description: REVIEW_LIST_DUE_DESCRIPTION,
      inputSchema: reviewListDueInputSchema.shape,
    },
    async (args: ReviewListDueToolInput) => {
      const envelope = await handleReviewListDue(args, ctx);
      return toolResponse(envelope);
    },
  );
}
