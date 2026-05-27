/**
 * Parent orchestration — spawn one worker per workflow, parse each
 * worker's JSON output, and aggregate (#941).
 *
 * Splits cleanly from the worker so the parent has zero adapter/JXA
 * imports — that keeps the spawn cost on the worker side, and means
 * the parent can be unit-tested by injecting a fake spawn function.
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateWorkflow } from "./aggregate.js";
import type { WorkerOutput, WorkflowLatency } from "./types.js";
import { WORKFLOWS } from "./workflows.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = resolve(HERE, "worker.ts");

export interface WorkerSpawn {
  /** Pre-aggregation worker payload (raw events + workflow timing). */
  raw: WorkerOutput;
  /** Aggregated rollup, computed from `raw.events`. */
  result: WorkflowLatency;
}

/**
 * Shape of the function that actually launches a worker. The default
 * implementation spawns a `tsx` subprocess; tests inject a fake that
 * returns canned output without touching `osascript`.
 */
export type WorkerLauncher = (workflow: string) => Promise<WorkerOutput>;

/** Production launcher: `tsx <worker.ts> --workflow <name>`. */
export const defaultWorkerLauncher: WorkerLauncher = (workflow) =>
  new Promise<WorkerOutput>((resolveOut, rejectOut) => {
    const child = spawn("node", ["--import", "tsx", WORKER_PATH, "--workflow", workflow], {
      // Inherit env so the worker sees the user's OMNIFOCUS_* config.
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    child.on("error", (err) => rejectOut(err));
    child.on("close", (code) => {
      if (code !== 0) {
        const stderrStr = Buffer.concat(stderrChunks).toString("utf8");
        rejectOut(new Error(`worker '${workflow}' exited ${code}: ${stderrStr}`));
        return;
      }
      const stdoutStr = Buffer.concat(stdoutChunks).toString("utf8");
      try {
        resolveOut(JSON.parse(stdoutStr) as WorkerOutput);
      } catch (err) {
        rejectOut(
          new Error(
            `worker '${workflow}' produced invalid JSON: ${(err as Error).message}\n${stdoutStr.slice(0, 400)}`,
          ),
        );
      }
    });
  });

/**
 * Run every registered workflow in its own worker process and
 * aggregate the results. Workflows run sequentially (not in parallel)
 * so they don't fight over the single osascript instance / OmniFocus
 * write lock.
 */
export async function runAllWorkflows(
  launcher: WorkerLauncher = defaultWorkerLauncher,
): Promise<WorkerSpawn[]> {
  const out: WorkerSpawn[] = [];
  for (const [workflow] of WORKFLOWS) {
    const raw = await launcher(workflow);
    out.push({ raw, result: aggregateWorkflow(workflow, raw.events) });
  }
  return out;
}
