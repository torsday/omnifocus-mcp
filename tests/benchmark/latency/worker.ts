/**
 * Worker entry — runs a single workflow in its own Node process and
 * emits the recorded events as JSON to stdout (#941).
 *
 * Per-workflow process isolation is the whole reason for the worker
 * split: it gives each workflow a freshly-spawned osascript runtime,
 * so the "first call to that script" timing genuinely captures the
 * spawn-dominated cold case. Running multiple workflows in the same
 * process would warm the runtime after the first workflow and bias
 * every subsequent workflow's cold numbers downward.
 *
 * Invocation contract:
 *   node ... worker.js --workflow <name>
 * Output contract (always exit 0 unless argv is invalid; workflow
 * errors propagate via `error` in the JSON payload):
 *   {"workflow": "...", "workflowDurationMs": N, "events": [...], "error"?: "..."}
 */

import { performance } from "node:perf_hooks";
import { createLatencyBenchContext } from "./context.js";
import { Recorder } from "./recorder.js";
import type { WorkerOutput } from "./types.js";
import { lookupWorkflow } from "./workflows.js";

function parseArgs(argv: readonly string[]): { workflow: string } {
  const idx = argv.indexOf("--workflow");
  if (idx < 0 || idx === argv.length - 1) {
    throw new Error("worker: --workflow <name> is required");
  }
  return { workflow: argv[idx + 1]! };
}

async function main(): Promise<void> {
  const { workflow } = parseArgs(process.argv.slice(2));
  const runner = lookupWorkflow(workflow);
  if (runner === undefined) {
    throw new Error(`worker: unknown workflow '${workflow}'`);
  }

  const recorder = new Recorder();
  recorder.start();

  const t0 = performance.now();
  let error: string | undefined;
  try {
    const ctx = createLatencyBenchContext();
    await runner(ctx);
  } catch (err) {
    // Preserve typed errors as plain strings — the parent only logs them.
    error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  } finally {
    recorder.stop();
  }
  const workflowDurationMs = performance.now() - t0;

  const output: WorkerOutput = {
    workflow,
    workflowDurationMs,
    events: recorder.events,
    ...(error !== undefined ? { error } : {}),
  };
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  // Pre-flight failures (bad argv, missing workflow) are real config errors —
  // exit non-zero so the parent surfaces them rather than silently aggregating
  // an empty result.
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
