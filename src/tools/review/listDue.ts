/**
 * `review_list_due` MCP tool — list projects due for review.
 *
 * @see src/services/reviewService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type ResponseMeta, ok } from "../../envelope/index.js";
import type { ReviewService } from "../../services/reviewService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const REVIEW_LIST_DUE_DESCRIPTION =
  "List projects due for review in OmniFocus — those whose next review date is today or earlier, or has never been set. " +
  "Sorted by next review date ascending (overdue first, never-reviewed first). " +
  "Do not use to get all projects; prefer project_list for that. " +
  "Returns each project's id, name, nextReviewDate, lastReviewDate, and reviewIntervalDays. " +
  "Safe to call repeatedly; no side effects, no writes.";

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
  return ok({ projects: result.projects }, meta);
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
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
