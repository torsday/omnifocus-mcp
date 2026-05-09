/**
 * Vitest entry for the token-cost benchmark suite (#771).
 *
 * Gated on `OMNIFOCUS_BENCH=1` so it does not bloat the default test
 * matrix — the suite is hermetic (in-memory adapter, no external IO),
 * but it produces console output and is intended to run as a separate
 * CI job per the suite's README.
 *
 * The single `bench` test runs every workflow against a fresh
 * {@link createBenchContext}, builds the snapshot payload, and
 * compares against the checked-in baseline. Drift ≥ 5% in any
 * tracked field fails the test.
 */

import { describe, expect, test } from "vitest";
import { createBenchContext, measureToolsListOnce, type WorkflowResult } from "./runBench.js";
import { buildSnapshot, diffSnapshots, formatDrift, readSnapshot } from "./snapshot.js";
import { runInboxTriage } from "./workflows/inboxTriage.js";
import { runProjectPlanning } from "./workflows/projectPlanning.js";
import { runWeeklyReview } from "./workflows/weeklyReview.js";

const ENABLED = process.env.OMNIFOCUS_BENCH === "1";

if (!ENABLED) {
  describe("token-cost benchmark", () => {
    test.skip("skipped — set OMNIFOCUS_BENCH=1 to run", () => {});
  });
} else {
  describe("token-cost benchmark", () => {
    test("workflows match baseline within 5% tolerance", async () => {
      const toolListBytes = measureToolsListOnce();
      const results: WorkflowResult[] = [];

      for (const runner of [runInboxTriage, runWeeklyReview, runProjectPlanning]) {
        const bench = await runner(createBenchContext());
        results.push(bench.result(toolListBytes));
      }

      const current = buildSnapshot(results);
      const baseline = readSnapshot();
      if (baseline === undefined) {
        throw new Error("no baseline snapshot — run `pnpm bench:tokens --update` to generate one");
      }
      const drift = diffSnapshots(baseline, current);
      expect(drift, `drift detected:\n${formatDrift(drift)}`).toEqual([]);
    });
  });
}
