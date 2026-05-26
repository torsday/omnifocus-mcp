/**
 * Fixture workflow — large-list pagination (#1029).
 *
 * Closes the last categorical gap from #831's coverage audit: cursor-driven
 * paging. Seeds 120 tasks under one project, then walks `task_list` at
 * `{ limit: 50 }` until `meta.pagination.hasMore` is false — three pages
 * (50 + 50 + 20) in this fixture.
 *
 * The gate-sensitive shapes this workflow surfaces:
 *
 *   - cursor codec bytes per page (opaque token in `meta.pagination.cursor`),
 *   - per-row payload at a representative limit (50),
 *   - the small trailing page that exercises the `hasMore: false` envelope.
 *
 * Coverage matrix lives in `docs/benchmarks/coverage-matrix.md`.
 */

import { handleTaskList } from "../../../../src/tools/task/list.js";
import { Bench, type BenchToolContext } from "../runBench.js";

const TASK_NOTE =
  "Routine action; revisit owner & deadline at end-of-week. " +
  "Background captured in adjacent thread.";

async function seedLargePaginationDatabase(ctx: BenchToolContext): Promise<void> {
  const projectId = await ctx.adapter.createProject({
    name: "Large-pagination fixture",
    note: "120 tasks for the bench's cursor-paging shape.",
  });
  // 120 tasks → 3 pages at limit 50 (sizes 50, 50, 20). Keep per-task note
  // size modest so the per-page payload stays in the same order of magnitude
  // as the existing fixtures and the snapshot is comparable.
  for (let t = 0; t < 120; t += 1) {
    await ctx.adapter.createTask({
      name: `paged item ${String(t + 1).padStart(3, "0")}`,
      projectId,
      note: TASK_NOTE,
    });
  }
}

export async function runLargePagination(ctx: BenchToolContext): Promise<Bench> {
  const bench = new Bench("large-pagination");

  await seedLargePaginationDatabase(ctx);

  let cursor: string | undefined;
  let page = 0;
  // Cap the loop defensively — three pages are expected; 6 means we drifted.
  for (page = 1; page <= 6; page += 1) {
    const input: { limit: number; cursor?: string } = { limit: 50 };
    if (cursor !== undefined) input.cursor = cursor;
    const env = await bench.call("task_list", input, () =>
      handleTaskList(input, { taskService: ctx.taskService, makeMeta: ctx.makeMeta }),
    );
    if (!("data" in env)) {
      throw new Error(`task_list page ${page} did not succeed`);
    }
    const next = env.pagination?.cursor ?? null;
    const hasMore = env.pagination?.hasMore ?? false;
    if (!hasMore || next === null) break;
    cursor = next;
  }
  if (page > 3) {
    throw new Error(`large-pagination walked ${page} pages; expected 3 — fixture drifted`);
  }

  return bench;
}
