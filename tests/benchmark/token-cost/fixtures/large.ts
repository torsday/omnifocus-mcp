/**
 * Large-fixture seeder for the token-cost bench (#1030).
 *
 * Pre-populates the `BenchToolContext`'s in-memory adapter with a
 * production-shape dataset (≥ 5000 tasks, ≥ 50 projects, ≥ 20 tags) so
 * the smoke run exercises per-workflow timing at scale. Perf
 * regressions that only surface above the workflows' own ~20-task
 * seeds — `flattenedTasks()` cost growth, per-tag iteration in
 * `perspective_evaluate`, JxaTransport spawn cost — get caught here
 * instead of at the next release.
 *
 * Pure in-memory: uses the existing `BenchToolContext.adapter` (the
 * `InMemoryAdapter` per ADR-0014's E2E memory mode). No live OF
 * dependency, no `osascript` spawn.
 *
 * Run via `pnpm bench:tokens --smoke-5k` from `cli.ts`.
 */

import type { BenchToolContext } from "../runBench.js";

/**
 * Seed dimensions — keep round-numbered for predictable bench output
 * across re-runs. Total tasks land at the 5000+ floor #1030 requires.
 */
export const LARGE_FIXTURE = {
  /** Number of projects to create. Each project gets `tasksPerProject` tasks. */
  projects: 50,
  /** Tasks per project — 50 × 100 = 5000 tasks total. */
  tasksPerProject: 100,
  /** Tags to create. Each task gets one assigned round-robin. */
  tags: 20,
} as const;

const NOTE_TEMPLATE =
  "Routine action seeded by the large-fixture smoke runner. " +
  "Background omitted; the bytes here approximate a production-shape note.";

/**
 * Seed the bench context's adapter with the large fixture. Idempotent
 * per-call (creates new IDs each time) but should be called exactly
 * once on a fresh `createBenchContext()` — re-running against the same
 * adapter would stack additional copies.
 *
 * Returns the seeded counts for assertion in callers.
 */
export async function seedLargeFixture(
  ctx: BenchToolContext,
): Promise<{ projects: number; tasks: number; tags: number }> {
  // Create the tag pool first; tasks reference them by ID. Use the
  // adapter return type (TagId brand) so tasks can splice IDs straight
  // into `createTask` without an unsafe cast.
  type TagId = Awaited<ReturnType<typeof ctx.adapter.createTag>>;
  const tagIds: TagId[] = [];
  for (let g = 0; g < LARGE_FIXTURE.tags; g += 1) {
    const tagId = await ctx.adapter.createTag({
      name: `@bench-tag-${String(g + 1).padStart(2, "0")}`,
    });
    tagIds.push(tagId);
  }

  // Then projects with their tasks. Tasks round-robin through the tag
  // pool so search / perspective / forecast workloads see a realistic
  // per-tag spread (no single-tag hot-path on the 5k surface).
  let taskCount = 0;
  for (let p = 0; p < LARGE_FIXTURE.projects; p += 1) {
    const projectId = await ctx.adapter.createProject({
      name: `Bench fixture project ${String(p + 1).padStart(3, "0")}`,
      note: "Seeded by the 5k smoke runner; no special status.",
    });
    for (let t = 0; t < LARGE_FIXTURE.tasksPerProject; t += 1) {
      const tagId = tagIds[taskCount % tagIds.length];
      if (tagId === undefined) continue; // Defensive; tagIds.length > 0 guaranteed
      await ctx.adapter.createTask({
        name: `seeded task ${String(taskCount + 1).padStart(4, "0")}`,
        projectId,
        note: NOTE_TEMPLATE,
        tagIds: [tagId],
        flagged: taskCount % 7 === 0, // ~14% flagged
      });
      taskCount += 1;
    }
  }

  return {
    projects: LARGE_FIXTURE.projects,
    tasks: taskCount,
    tags: tagIds.length,
  };
}
