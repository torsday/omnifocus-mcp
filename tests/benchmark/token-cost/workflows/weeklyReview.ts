/**
 * Fixture workflow — weekly review pass over a seeded database (#771).
 *
 * Models the Friday-afternoon GTD ritual: list every project due for
 * review, walk each one (read its tasks), make small triage updates,
 * mark it reviewed, repeat. The seeded database carries five projects
 * so the workflow exercises a representative N rather than spending
 * its byte budget on a single project's iteration.
 */

import { handleReviewListDue } from "../../../../src/tools/review/listDue.js";
import { handleProjectMarkReviewed } from "../../../../src/tools/review/projectMarkReviewed.js";
import { handleTaskList } from "../../../../src/tools/task/list.js";
import { Bench, type BenchToolContext } from "../runBench.js";

const PROJECT_NOTE =
  "Owners: alex, jamie. Status: active. Last review surfaced two blocked items and one stale defer date.";

async function seedReviewDatabase(ctx: BenchToolContext): Promise<void> {
  // Five projects, three tasks each. Set the next-review date in the past
  // so every project shows up under review_list_due.
  const past = "2026-04-15T00:00:00.000Z";
  for (let p = 0; p < 5; p += 1) {
    const projectId = await ctx.adapter.createProject({
      name: `Review fixture project ${String(p + 1).padStart(2, "0")}`,
      note: PROJECT_NOTE,
    });
    await ctx.adapter.updateProject(projectId, { reviewIntervalDays: 7 });
    await ctx.adapter.setProjectNextReviewDate(projectId, past);
    for (let t = 0; t < 3; t += 1) {
      await ctx.adapter.createTask({
        name: `Open thread ${String(t + 1)} on project ${String(p + 1)}`,
        projectId,
        note: "Captured during last review; revisit owner & deadline.",
      });
    }
  }
}

export async function runWeeklyReview(ctx: BenchToolContext): Promise<Bench> {
  const bench = new Bench("weekly-review");

  await seedReviewDatabase(ctx);

  // 1) List everything due for review.
  const listEnv = await bench.call("review_list_due", {}, () =>
    handleReviewListDue({}, { reviewService: ctx.reviewService, makeMeta: ctx.makeMeta }),
  );
  if (!("data" in listEnv)) throw new Error("review_list_due did not succeed");
  const projects = listEnv.data.projects;

  // 2) For each project: read its task list, then mark it reviewed.
  for (const p of projects) {
    const tlInput = { projectId: p.id, limit: 50 };
    await bench.call("task_list", tlInput, () =>
      handleTaskList(tlInput, { taskService: ctx.taskService, makeMeta: ctx.makeMeta }),
    );
    const markInput = { id: p.id };
    await bench.call("project_mark_reviewed", markInput, () =>
      handleProjectMarkReviewed(markInput, {
        reviewService: ctx.reviewService,
        makeMeta: ctx.makeMeta,
      }),
    );
  }

  return bench;
}
