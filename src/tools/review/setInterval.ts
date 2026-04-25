/**
 * `review_set_interval` MCP tool — set a project's review interval.
 *
 * @see src/services/reviewService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ProjectId as ProjectIdCtor } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ReviewService } from "../../services/reviewService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const REVIEW_SET_INTERVAL_DESCRIPTION =
  "Set a project's review interval in OmniFocus — updates how many days between reviews. " +
  "Use null to remove the recurring schedule. " +
  "Do not use to mark a project as reviewed; prefer review_mark_reviewed for that. " +
  "Returns the project id. Sets syncPending: true.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const reviewSetIntervalInputSchema = z.object({
  id: z.string().min(1).describe("Persistent ID of the project to update."),
  days: z
    .number()
    .int()
    .min(1)
    .nullable()
    .describe("Review interval in days. Pass null to remove the recurring review schedule."),
});

export type ReviewSetIntervalToolInput = z.infer<typeof reviewSetIntervalInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ReviewSetIntervalContext {
  reviewService: ReviewService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleReviewSetInterval(
  input: ReviewSetIntervalToolInput,
  ctx: ReviewSetIntervalContext,
) {
  await ctx.reviewService.setInterval(ProjectIdCtor.of(input.id), input.days);
  return ok({ id: input.id }, ctx.makeMeta({ syncPending: true }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerReviewSetIntervalTool(server: McpServer, ctx: ReviewSetIntervalContext) {
  return server.registerTool(
    "review_set_interval",
    {
      description: REVIEW_SET_INTERVAL_DESCRIPTION,
      inputSchema: reviewSetIntervalInputSchema.shape,
    },
    async (args: ReviewSetIntervalToolInput) => {
      const envelope = await handleReviewSetInterval(args, ctx);
      return toolResponse(envelope);
    },
  );
}
