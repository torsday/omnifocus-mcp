/**
 * CLI entry — `pnpm bench:latency` (#941).
 *
 * Runs every workflow (each in its own worker process), prints a
 * markdown table per workflow plus an overall summary, then either
 * compares against the checked-in baseline (default) or rewrites it
 * (`--update`). Exits non-zero on drift ≥ `DRIFT_FAIL_PCT`.
 *
 * **Requires** OmniFocus to be running locally — the workers spawn
 * `osascript` against the user's database. See the suite's README for
 * the cleanup caveat.
 */

import { runAllWorkflows } from "./runBench.js";
import {
  buildSnapshot,
  DRIFT_FAIL_PCT,
  diffSnapshots,
  formatDrift,
  readSnapshot,
  SNAPSHOT_PATH,
  writeSnapshot,
} from "./snapshot.js";
import type { WorkflowLatency } from "./types.js";

function pad(label: string, w: number): string {
  return label.length >= w ? label : `${label}${" ".repeat(w - label.length)}`;
}

function fmtMs(n: number): string {
  if (n < 10) return n.toFixed(1);
  return n.toFixed(0);
}

function printWorkflow(wf: WorkflowLatency): void {
  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(`\n# ${wf.workflow}`);
  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(
    `  calls: ${wf.callCount}  total: ${fmtMs(wf.totalDurationMs)} ms  ` +
      `spawn share: ${wf.spawnPctOfTotal.toFixed(1)}%`,
  );
  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(
    `  | ${pad("script", 26)} | ${pad("count", 5)} | ${pad("p50", 7)} | ${pad("p95", 7)} | ${pad("max", 7)} | ${pad("cold p95", 9)} | ${pad("warm p95", 9)} |`,
  );
  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(
    `  | ${"-".repeat(26)} | ${"-".repeat(5)} | ${"-".repeat(7)} | ${"-".repeat(7)} | ${"-".repeat(7)} | ${"-".repeat(9)} | ${"-".repeat(9)} |`,
  );
  for (const script of Object.keys(wf.byScript).sort()) {
    const s = wf.byScript[script]!;
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.log(
      `  | ${pad(script, 26)} | ${pad(String(s.count), 5)} | ` +
        `${pad(`${fmtMs(s.p50Ms)} ms`, 7)} | ` +
        `${pad(`${fmtMs(s.p95Ms)} ms`, 7)} | ` +
        `${pad(`${fmtMs(s.maxMs)} ms`, 7)} | ` +
        `${pad(`${fmtMs(s.coldP95Ms)} ms`, 9)} | ` +
        `${pad(s.warmP95Ms === null ? "—" : `${fmtMs(s.warmP95Ms)} ms`, 9)} |`,
    );
  }
}

async function main(): Promise<void> {
  const update = process.argv.includes("--update");

  const spawns = await runAllWorkflows();
  const results = spawns.map((s) => s.result);

  // Surface any worker-side errors before drift compare — a workflow that
  // bombed mid-run produces unreliable numbers; fail loudly.
  const failed = spawns.filter((s) => s.raw.error !== undefined);
  if (failed.length > 0) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI output
    console.error("\nworker errors:");
    for (const f of failed) {
      // biome-ignore lint/suspicious/noConsole: intentional CLI output
      console.error(`  ${f.raw.workflow}: ${f.raw.error}`);
    }
    process.exit(1);
  }

  for (const r of results) printWorkflow(r);

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
      `\nno baseline snapshot at ${SNAPSHOT_PATH} — run \`pnpm bench:latency --update\` to create one`,
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
