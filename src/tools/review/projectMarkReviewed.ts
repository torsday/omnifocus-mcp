/**
 * `project_mark_reviewed` MCP tool — convenience alias for review_mark_reviewed.
 *
 * @see src/services/reviewService.ts
 * @see src/tools/review/markReviewed.ts — canonical implementation
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

export const PROJECT_MARK_REVIEWED_DESCRIPTION =
  "Convenience alias for review_mark_reviewed — mark a single project as reviewed, setting lastReviewDate to now and advancing nextReviewDate. " +
  "Use when you have a project id and want a single-call review operation. " +
  "Do not use to list projects due for review; prefer review_list_due for that. " +
  "Returns the project id. " +
  "Side effects: writes to OmniFocus; sets syncPending = true.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const projectMarkReviewedInputSchema = z.object({
  id: z.string().min(1).describe("Persistent ID of the project to mark as reviewed."),
});

export type ProjectMarkReviewedToolInput = z.infer<typeof projectMarkReviewedInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ProjectMarkReviewedContext {
  reviewService: ReviewService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleProjectMarkReviewed(
  input: ProjectMarkReviewedToolInput,
  ctx: ProjectMarkReviewedContext,
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

export function registerProjectMarkReviewedTool(
  server: McpServer,
  ctx: ProjectMarkReviewedContext,
) {
  return server.registerTool(
    "project_mark_reviewed",
    {
      description: PROJECT_MARK_REVIEWED_DESCRIPTION,
      inputSchema: projectMarkReviewedInputSchema.shape,
    },
    async (args: ProjectMarkReviewedToolInput) => {
      const envelope = await handleProjectMarkReviewed(args, ctx);
      return toolResponse(envelope);
    },
  );
}
