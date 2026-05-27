/**
 * Vitest entry for the latency benchmark suite (#941).
 *
 * Gated on `OMNIFOCUS_LATENCY_BENCH=1` so it stays out of the default
 * test matrix — workers spawn real `osascript` and require OmniFocus
 * to be running. The CI workflow at
 * `.github/workflows/latency-bench.yml` is the canonical caller.
 *
 * Unit tests for the harness itself live in `*.test.ts` siblings of
 * each module (aggregate.test.ts, snapshot.test.ts, percentiles.test.ts)
 * and run on every push — those don't need OmniFocus.
 */

import { describe, expect, test } from "vitest";
import { runAllWorkflows } from "./runBench.js";
import { buildSnapshot, diffSnapshots, formatDrift, readSnapshot } from "./snapshot.js";

const ENABLED = process.env.OMNIFOCUS_LATENCY_BENCH === "1";

if (!ENABLED) {
  describe("latency benchmark", () => {
    test.skip("skipped — set OMNIFOCUS_LATENCY_BENCH=1 to run", () => {});
  });
} else {
  describe("latency benchmark", () => {
    test(
      "workflows match baseline within tolerance",
      async () => {
        const spawns = await runAllWorkflows();
        const errs = spawns
          .filter((s) => s.raw.error !== undefined)
          .map((s) => `${s.raw.workflow}: ${s.raw.error}`);
        if (errs.length > 0) {
          throw new Error(`worker errors:\n${errs.join("\n")}`);
        }
        const current = buildSnapshot(spawns.map((s) => s.result));
        const baseline = readSnapshot();
        if (baseline === undefined) {
          throw new Error(
            "no baseline snapshot — run `pnpm bench:latency --update` to generate one",
          );
        }
        const drift = diffSnapshots(baseline, current);
        expect(drift, `drift detected:\n${formatDrift(drift)}`).toEqual([]);
      },
      // Wall-clock benches against real OmniFocus take minutes.
      10 * 60 * 1000,
    );
  });
}
