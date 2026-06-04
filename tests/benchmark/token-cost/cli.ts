/**
 * CLI entry for `pnpm bench:tokens` (#771).
 *
 * Runs every fixture workflow, prints a human-readable per-workflow
 * summary, and either compares against the checked-in baseline (default)
 * or rewrites it (`--update`). Exits non-zero on drift ≥ 5%.
 *
 * **`--smoke-5k`** (#1030): pre-seed the bench adapter with the large
 * fixture (≥ 5000 tasks / 50 projects / 20 tags) before running each
 * workflow. Prints per-workflow wall-time so humans can eyeball
 * regressions at scale. Does NOT compare against the byte-cost
 * baseline (the seed dwarfs every workflow's per-call traffic). CI
 * auto-budget enforcement is intentionally deferred — see #1030's
 * close-out for the flake-resistance follow-up.
 */

import { performance } from "node:perf_hooks";

import { seedLargeFixture } from "./fixtures/large.js";
import { createBenchContext, measureToolsListOnce, type WorkflowResult } from "./runBench.js";
import {
  buildSnapshot,
  DRIFT_FAIL_PCT,
  diffSnapshots,
  formatDrift,
  readSnapshot,
  SNAPSHOT_PATH,
  writeSnapshot,
} from "./snapshot.js";
import { estimateTokens } from "./tokenizer.js";
import { runCapTruncation } from "./workflows/capTruncation.js";
import { runDensityFull } from "./workflows/densityFull.js";
import { runEndOfDayReview } from "./workflows/endOfDayReview.js";
import { runInboxTriage } from "./workflows/inboxTriage.js";
import { runLargePagination } from "./workflows/largePagination.js";
import { runProjectPlanning } from "./workflows/projectPlanning.js";
import { runSyncDelta } from "./workflows/syncDelta.js";
import { runWeeklyReview } from "./workflows/weeklyReview.js";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KiB`;
}

function pad(label: string, w: number): string {
  return label.length >= w ? label : `${label}${" ".repeat(w - label.length)}`;
}

async function main(): Promise<void> {
  const update = process.argv.includes("--update");
  const smoke5k = process.argv.includes("--smoke-5k");

  const toolListBytes = measureToolsListOnce();
  const results: WorkflowResult[] = [];

  // `large-pagination` makes a hard assertion about exact page count
  // (= 3) against the workflow's own 120-task seed. The 5k smoke seed
  // would bust that gate — the workflow tests *pagination invariants*,
  // not scale behavior, so skip it from smoke mode. The rest of the
  // workflows degrade gracefully (no per-page-count assertions) and
  // produce meaningful wall-times under the seeded surface.
  const workflows = [
    ["inbox-triage", runInboxTriage] as const,
    ["weekly-review", runWeeklyReview] as const,
    ["project-planning", runProjectPlanning] as const,
    ["end-of-day-review", runEndOfDayReview] as const,
    ["large-pagination", runLargePagination] as const,
    ["cap-truncation", runCapTruncation] as const,
    ["density-full", runDensityFull] as const,
    ["sync-delta", runSyncDelta] as const,
  ];
  const activeWorkflows = smoke5k
    ? workflows.filter(([label]) => label !== "large-pagination")
    : workflows;

  for (const [label, runner] of activeWorkflows) {
    const ctx = createBenchContext();
    let seedDurationMs = 0;
    if (smoke5k) {
      const t0 = performance.now();
      const seed = await seedLargeFixture(ctx);
      seedDurationMs = performance.now() - t0;
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.log(
        `\n[smoke-5k seed] ${seed.tasks} tasks / ${seed.projects} projects / ${seed.tags} tags in ${seedDurationMs.toFixed(0)} ms`,
      );
    }
    const t0 = performance.now();
    const bench = await runner(ctx);
    const workflowMs = performance.now() - t0;
    const result = bench.result(toolListBytes);
    results.push(result);
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`\n# ${label}`);
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(
      `  calls: ${result.callCount}  ` +
        `req: ${fmtBytes(result.totalRequestBytes)}  ` +
        `res: ${fmtBytes(result.totalResponseBytes)}  ` +
        `total: ${fmtBytes(result.totalRoundTripBytes)}  ` +
        `tokens: ${result.totalTokens}` +
        (smoke5k ? `  wall=${workflowMs.toFixed(0)}ms` : ""),
    );
    for (const tool of Object.keys(result.byTool).sort()) {
      const slot = result.byTool[tool]!;
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.log(`    ${pad(tool, 26)} calls=${slot.calls}  res=${fmtBytes(slot.responseBytes)}`);
    }
  }

  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(
    `\ntools/list payload: ${fmtBytes(toolListBytes)} (~${estimateTokens(toolListBytes)} tokens)`,
  );

  if (smoke5k) {
    // Smoke mode is observational. Don't compare against the byte-cost
    // baseline (the 5k seed dwarfs each workflow's own per-call traffic
    // and would always read as drift). The wall-time numbers above are
    // for human inspection until CI gate design lands (see #1030
    // close-out follow-up).
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log("\n[smoke-5k] observational mode — no baseline comparison, no CI gate yet.");
    return;
  }

  const current = buildSnapshot(results);

  if (update) {
    writeSnapshot(current);
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(`\nbaseline updated: ${SNAPSHOT_PATH}`);
    return;
  }

  const baseline = readSnapshot();
  if (baseline === undefined) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(
      `\nno baseline snapshot at ${SNAPSHOT_PATH} — run \`pnpm bench:tokens --update\` to create one`,
    );
    process.exit(1);
  }
  const drift = diffSnapshots(baseline, current);
  if (drift.length > 0) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error(`\ndrift ≥ ${DRIFT_FAIL_PCT}%:\n${formatDrift(drift)}`);
    process.exit(1);
  }
  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(`\nno drift ≥ ${DRIFT_FAIL_PCT}% — baseline holds`);
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: intentional CLI error
  console.error(err);
  process.exit(1);
});
