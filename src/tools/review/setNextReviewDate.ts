/**
 * `project_set_next_review_date` MCP tool — set or clear a project's next
 * review date directly.
 *
 * Third axis of the review schedule (alongside interval and last-reviewed).
 * Lets agents reschedule a review without mutating the recurring cadence —
 * "push the Q3 review to next Monday" without changing the every-12-week
 * pattern.
 *
 * @see #467
 * @see src/scripts/jxa/project_set_next_review_date.js
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isoDateString } from "../../domain/dates.js";
import { ProjectId as ProjectIdCtor } from "../../domain/ids.js";
import { summaryReviewSetNextReviewDate } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ReviewService } from "../../services/reviewService.js";

export const PROJECT_SET_NEXT_REVIEW_DATE_DESCRIPTION =
  "Set or clear a project's next review date directly. " +
  "Use when the user wants to reschedule a review independent of the recurring interval — 'push the Q3 review to next Monday' without changing the cadence. " +
  "Do NOT use to mark a project as reviewed (prefer review_mark_reviewed) or to change the recurring interval (prefer review_set_interval). " +
  "Pass projectId and nextReviewDate (ISO-8601 with offset), or pass null for nextReviewDate to clear (project becomes 'not scheduled'). " +
  "Past-dated values are accepted and surface the project as overdue immediately — matches OmniFocus's own UX. " +
  "Returns { id, name, nextReviewDate } — name is the project's display name (post-mutation lookup; null if the project has been deleted), and nextReviewDate echoes back the new value (or null when cleared) so the agent can describe the change without a follow-up read. " +
  "Errors: NOT_FOUND when projectId does not exist. " +
  "Side effects: writes to OmniFocus; invalidates project + review caches; sets syncPending = true. " +
  'Example: project_set_next_review_date({ projectId: "prj123", nextReviewDate: "2026-05-05T00:00:00-05:00" }) ' +
  'Example: project_set_next_review_date({ projectId: "prj123", nextReviewDate: null })';

export const projectSetNextReviewDateInputSchema = z.object({
  projectId: z
    .string()
    .min(1)
    .describe("Persistent ID of the project whose next review date should change."),
  nextReviewDate: z
    .union([isoDateString(), z.null()])
    .describe(
      "Next review date as ISO-8601 (with offset). Pass null to clear the schedule. " +
        "Past-dated values are accepted and mark the project as overdue immediately.",
    ),
});

export type ProjectSetNextReviewDateToolInput = z.infer<typeof projectSetNextReviewDateInputSchema>;

export interface ProjectSetNextReviewDateContext {
  reviewService: ReviewService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleProjectSetNextReviewDate(
  input: ProjectSetNextReviewDateToolInput,
  ctx: ProjectSetNextReviewDateContext,
) {
  const outcome = await ctx.reviewService.setNextReviewDate(
    ProjectIdCtor.of(input.projectId),
    input.nextReviewDate,
  );
  return ok(
    { id: input.projectId, name: outcome.name, nextReviewDate: outcome.nextReviewDate },
    ctx.makeMeta({
      syncPending: true,
      humanReadableSummary: summaryReviewSetNextReviewDate(input.nextReviewDate),
    }),
  );
}

export function registerProjectSetNextReviewDateTool(
  server: McpServer,
  ctx: ProjectSetNextReviewDateContext,
) {
  return server.registerTool(
    "project_set_next_review_date",
    {
      description: PROJECT_SET_NEXT_REVIEW_DATE_DESCRIPTION,
      inputSchema: projectSetNextReviewDateInputSchema.shape,
    },
    async (args: ProjectSetNextReviewDateToolInput) => {
      const envelope = await handleProjectSetNextReviewDate(args, ctx);
      return toolResponse(envelope);
    },
  );
}
