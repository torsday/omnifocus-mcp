/**
 * Fixture workflow — end-of-day review (#831).
 *
 * Closes three coverage gaps in one coherent narrative:
 *
 *   - **search** — `task_search` looking for stuck items by keyword;
 *   - **forecast** — `forecast_get` over today + the next two days;
 *   - **perspective** — `perspective_evaluate` of the `flagged` built-in.
 *
 * Coverage matrix lives in `docs/benchmarks/coverage-matrix.md`; this
 * workflow is the canonical example of a multi-category bench fixture.
 * One narrative, three tools — keeps the bench's per-workflow byte
 * budget meaningful for downstream tracking instead of fragmenting
 * each missing category into its own micro-fixture.
 *
 * Database shape: 4 projects × 5 tasks (= 20 tasks), with a flagged
 * subset and a small handful of due-today dates. Sized to surface
 * representative response bytes without dwarfing the existing
 * fixtures' totals.
 */

import { handleForecastGet } from "../../../../src/tools/forecast/get.js";
import { handlePerspectiveEvaluate } from "../../../../src/tools/perspective/evaluate.js";
import { handleTaskSearch } from "../../../../src/tools/task/search.js";
import { Bench, type BenchToolContext } from "../runBench.js";

const TASK_NOTE =
  "Captured earlier in the week. Pending decision; revisit before end of day. " +
  "Stakeholders to ping: alex, jamie. Background context links omitted.";

async function seedEndOfDayDatabase(ctx: BenchToolContext): Promise<void> {
  const today = new Date();
  // Anchor "due today" exactly at noon local to avoid timezone edge cases
  // while still landing inside the day.
  const noon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).toISOString();

  for (let p = 0; p < 4; p += 1) {
    const projectId = await ctx.adapter.createProject({
      name: `End-of-day project ${String(p + 1).padStart(2, "0")}`,
      note: "Routine work, no special status.",
    });
    for (let t = 0; t < 5; t += 1) {
      const flagged = t % 2 === 0;
      const dueToday = t === 0;
      if (dueToday) {
        await ctx.adapter.createTask({
          name: `stuck thread ${String(t + 1)} on project ${String(p + 1)}`,
          projectId,
          note: TASK_NOTE,
          flagged,
          dueDate: noon,
        });
      } else {
        await ctx.adapter.createTask({
          name: `stuck thread ${String(t + 1)} on project ${String(p + 1)}`,
          projectId,
          note: TASK_NOTE,
          flagged,
        });
      }
    }
  }
}

export async function runEndOfDayReview(ctx: BenchToolContext): Promise<Bench> {
  const bench = new Bench("end-of-day-review");

  await seedEndOfDayDatabase(ctx);

  // 1) Search — "what's stuck?". Keyword + scope covers the canonical
  //    interactive use of task_search.
  const searchInput = { q: "stuck", scope: "all" as const, completed: "exclude" as const };
  await bench.call("task_search", searchInput, () =>
    handleTaskSearch(searchInput, { searchService: ctx.searchService, makeMeta: ctx.makeMeta }),
  );

  // 2) Forecast — today + next two days. Three-day window is the
  //    representative interactive shape ("what's on my plate this
  //    week?") rather than the unbounded one.
  const forecastInput = {
    days: 3,
    includeOverdue: true,
    includeDeferred: false,
    includeFlagged: true,
  };
  await bench.call("forecast_get", forecastInput, () =>
    handleForecastGet(forecastInput, {
      forecastService: ctx.forecastService,
      makeMeta: ctx.makeMeta,
    }),
  );

  // 3) Perspective — the `flagged` built-in. Exercises the whose()
  //    pushdown path (#789 / #894) that perspective_evaluate gained
  //    and that #899 source-narrowed further.
  const perspectiveInput = { perspectiveId: "flagged" as const };
  await bench.call("perspective_evaluate", perspectiveInput, () =>
    handlePerspectiveEvaluate(perspectiveInput, {
      perspectiveService: ctx.perspectiveService,
      makeMeta: ctx.makeMeta,
    }),
  );

  return bench;
}
