/**
 * CLI entry for `pnpm bench:tokens` (#771).
 *
 * Runs every fixture workflow, prints a human-readable per-workflow
 * summary, and either compares against the checked-in baseline (default)
 * or rewrites it (`--update`). Exits non-zero on drift ≥ 5%.
 */

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
import { runEndOfDayReview } from "./workflows/endOfDayReview.js";
import { runInboxTriage } from "./workflows/inboxTriage.js";
import { runLargePagination } from "./workflows/largePagination.js";
import { runProjectPlanning } from "./workflows/projectPlanning.js";
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

  const toolListBytes = measureToolsListOnce();
  const results: WorkflowResult[] = [];

  for (const [label, runner] of [
    ["inbox-triage", runInboxTriage] as const,
    ["weekly-review", runWeeklyReview] as const,
    ["project-planning", runProjectPlanning] as const,
    ["end-of-day-review", runEndOfDayReview] as const,
    ["large-pagination", runLargePagination] as const,
  ]) {
    const bench = await runner(createBenchContext());
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
        `tokens: ${result.totalTokens}`,
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
