/**
 * `review_mark_reviewed` MCP tool — mark a project as reviewed.
 *
 * @see src/services/reviewService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ProjectId as ProjectIdCtor } from "../../domain/ids.js";
import { summaryReviewMarkReviewed } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ReviewService } from "../../services/reviewService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const REVIEW_MARK_REVIEWED_DESCRIPTION =
  "Mark a project as reviewed in OmniFocus — sets lastReviewDate to now and advances nextReviewDate by the project's review interval. " +
  "Use this after completing a weekly review of a project. " +
  "Do not use to change the review interval; prefer review_set_interval for that. " +
  "Returns the project id. " +
  "Side effects: writes to OmniFocus; sets syncPending = true.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const reviewMarkReviewedInputSchema = z.object({
  id: z.string().min(1).describe("Persistent ID of the project to mark as reviewed."),
});

export type ReviewMarkReviewedToolInput = z.infer<typeof reviewMarkReviewedInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ReviewMarkReviewedContext {
  reviewService: ReviewService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleReviewMarkReviewed(
  input: ReviewMarkReviewedToolInput,
  ctx: ReviewMarkReviewedContext,
) {
  await ctx.reviewService.markReviewed(ProjectIdCtor.of(input.id));
  return ok(
    { id: input.id },
    ctx.makeMeta({ syncPending: true, humanReadableSummary: summaryReviewMarkReviewed() }),
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerReviewMarkReviewedTool(server: McpServer, ctx: ReviewMarkReviewedContext) {
  return server.registerTool(
    "review_mark_reviewed",
    {
      description: REVIEW_MARK_REVIEWED_DESCRIPTION,
      inputSchema: reviewMarkReviewedInputSchema.shape,
    },
    async (args: ReviewMarkReviewedToolInput) => {
      const envelope = await handleReviewMarkReviewed(args, ctx);
      return toolResponse(envelope);
    },
  );
}
