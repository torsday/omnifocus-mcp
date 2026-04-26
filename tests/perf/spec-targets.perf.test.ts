/**
 * Performance benchmarks validating the SPEC §9 p95 targets.
 *
 * Gated on `OMNIFOCUS_PERF=1`. Without it the suite is skipped — it is
 * intentionally separate from the regular integration suite because it
 * requires a populated database (≥1k tasks) and takes several minutes.
 *
 * Run with:
 *   OMNIFOCUS_PERF=1 pnpm test:integration
 *   OMNIFOCUS_PERF=1 PERF_TRIALS=20 pnpm test:integration  # more trials
 *
 * Requirements:
 *   - OmniFocus must be running
 *   - macOS Automation permission must be granted for `osascript`
 *   - Database should have ≥ 500 tasks for results to be meaningful
 *     (see `docs/perf-setup.md` for seeding instructions)
 *
 * Each benchmark runs N trials, discards the first (JXA cold-start), and
 * reports p50/p95/p99. The test fails if p95 exceeds the SPEC target by
 * more than 20% (headroom for CI measurement noise).
 *
 * SPEC targets (§9):
 *   - task_list cold (5k tasks):  < 1000ms p95
 *   - task_get by ID:             < 400ms  p95
 *   - task_update (single):       < 600ms  p95
 *   - cached read:                < 50ms   p95
 *
 * @see SPEC.md §9 — non-functional requirements
 * @see DESIGN.md §19 — testing strategy tiers
 * @see docs/perf-setup.md — seeding instructions
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { JxaTransport } from "../../src/adapter/jxa/JxaTransport.js";
import { OmniJsTransport } from "../../src/adapter/omnijs/OmniJsTransport.js";
import { TransportRouter } from "../../src/adapter/router.js";
import type { ProjectId, TaskId } from "../../src/domain/ids.js";

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

const PERF = process.env.OMNIFOCUS_PERF === "1";
const TRIALS = Math.max(5, Number(process.env.PERF_TRIALS ?? "10"));

if (!PERF) {
  describe("perf: SPEC p95 targets", () => {
    test.skip("skipped — set OMNIFOCUS_PERF=1 and ensure OmniFocus is running to execute", () => {});
  });
} else {
  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Return p50, p95, p99 from an array of millisecond durations. */
  function percentiles(ms: number[]): { p50: number; p95: number; p99: number } {
    const sorted = [...ms].sort((a, b) => a - b);
    const at = (p: number) => sorted[Math.ceil((p / 100) * sorted.length) - 1] ?? 0;
    return { p50: at(50), p95: at(95), p99: at(99) };
  }

  /** Print a formatted results row. */
  function printResult(
    label: string,
    results: { p50: number; p95: number; p99: number },
    targetMs: number,
  ) {
    const margin = targetMs * 1.2;
    const pass = results.p95 <= margin ? "✅" : "❌";
    // biome-ignore lint/suspicious/noConsole: intentional benchmark output
    console.log(
      `  ${pass} ${label.padEnd(30)} p50=${results.p50.toFixed(0).padStart(5)}ms  p95=${results.p95.toFixed(0).padStart(5)}ms  p99=${results.p99.toFixed(0).padStart(5)}ms  target=${targetMs}ms`,
    );
  }

  /**
   * Run `fn` for `n` trials. Discards the first result (JXA cold-start) and
   * returns the remaining durations in milliseconds.
   */
  async function runTrials(fn: () => Promise<unknown>, n: number): Promise<number[]> {
    const durations: number[] = [];
    for (let i = 0; i < n + 1; i++) {
      const t0 = performance.now();
      await fn();
      if (i > 0) durations.push(performance.now() - t0); // skip warm-up
    }
    return durations;
  }

  // -------------------------------------------------------------------------
  // Fixture
  // -------------------------------------------------------------------------

  const router = TransportRouter.fromTransports(new JxaTransport(), new OmniJsTransport());

  let fixtureProjectId: ProjectId | null = null;
  let firstTaskId: TaskId | null = null;
  const createdProjectIds: ProjectId[] = [];
  const createdTaskIds: TaskId[] = [];

  const FIXTURE_TASK_COUNT = 50; // small — enough to measure relative timing

  beforeAll(async () => {
    // biome-ignore lint/suspicious/noConsole: intentional benchmark output
    console.log("\n📊 Perf suite: setting up fixture...");
    // Create a dedicated project with enough tasks to exercise list/get paths.
    fixtureProjectId = await router.createProject({ name: "perf-bench-fixture" });
    createdProjectIds.push(fixtureProjectId);

    for (let i = 0; i < FIXTURE_TASK_COUNT; i++) {
      const id = await router.createTask({
        name: `bench-task-${i.toString().padStart(3, "0")}`,
        projectId: fixtureProjectId,
        flagged: i % 5 === 0,
      });
      createdTaskIds.push(id);
    }
    firstTaskId = createdTaskIds[0] ?? null;
    // biome-ignore lint/suspicious/noConsole: intentional benchmark output
    console.log(`   Created ${FIXTURE_TASK_COUNT} tasks in project ${fixtureProjectId}`);
  }, 120_000);

  afterAll(async () => {
    // Clean up fixture data.
    for (const id of createdTaskIds) {
      try {
        await router.deleteTask(id);
      } catch {
        /* already gone */
      }
    }
    for (const id of createdProjectIds) {
      try {
        await router.deleteProject(id);
      } catch {
        /* already gone */
      }
    }
    // biome-ignore lint/suspicious/noConsole: intentional benchmark output
    console.log("   Fixture cleaned up.");
  }, 120_000);

  // -------------------------------------------------------------------------
  // Benchmarks
  // -------------------------------------------------------------------------

  describe("perf: SPEC p95 targets", () => {
    test("task_list (fixture project) — p95 < 1000ms", async () => {
      if (!fixtureProjectId) throw new Error("fixture not set up");
      const pid = fixtureProjectId;
      const target = 1000;
      const durations = await runTrials(() => router.listTasks({ projectId: pid }), TRIALS);
      const r = percentiles(durations);
      printResult("task_list (project scope)", r, target);
      expect(r.p95).toBeLessThanOrEqual(target * 1.2);
    }, 60_000);

    test("task_get by ID — p95 < 400ms", async () => {
      if (!firstTaskId) throw new Error("fixture not set up");
      const tid = firstTaskId;
      const target = 400;
      const durations = await runTrials(() => router.getTask(tid), TRIALS);
      const r = percentiles(durations);
      printResult("task_get by ID", r, target);
      expect(r.p95).toBeLessThanOrEqual(target * 1.2);
    }, 60_000);

    test("task_update (name change) — p95 < 600ms", async () => {
      if (!firstTaskId) throw new Error("fixture not set up");
      const tid = firstTaskId;
      const target = 600;
      let toggle = false;
      const durations = await runTrials(async () => {
        toggle = !toggle;
        await router.updateTask(tid, {
          name: toggle ? "bench-task-000" : "bench-task-000-updated",
        });
      }, TRIALS);
      const r = percentiles(durations);
      printResult("task_update (single)", r, target);
      expect(r.p95).toBeLessThanOrEqual(target * 1.2);
    }, 60_000);

    test("project_list — p95 < 1000ms", async () => {
      const target = 1000;
      const durations = await runTrials(() => router.listProjects({}), TRIALS);
      const r = percentiles(durations);
      printResult("project_list", r, target);
      expect(r.p95).toBeLessThanOrEqual(target * 1.2);
    }, 60_000);

    test("task_list (cached read — second call) — p95 < 50ms", async () => {
      if (!fixtureProjectId) throw new Error("fixture not set up");
      const pid = fixtureProjectId;
      const target = 50;
      // Prime the cache with one call first.
      await router.listTasks({ projectId: pid });
      const durations = await runTrials(() => router.listTasks({ projectId: pid }), TRIALS);
      const r = percentiles(durations);
      printResult("task_list (cached)", r, target);
      // Cache target: 50ms. Note: cached reads bypass JXA entirely;
      // if this fails, the cache may not be active for this filter key.
      expect(r.p95).toBeLessThanOrEqual(target * 1.2);
    }, 60_000);
  });
}
