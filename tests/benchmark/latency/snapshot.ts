/**
 * Snapshot read/write/diff for the latency benchmark (#941).
 *
 * Mirrors `tests/benchmark/token-cost/snapshot.ts` but tracks wall-clock
 * fields. The drift policy is the same in *shape* — symmetric percentage
 * threshold — but **looser in size**: wall-clock measurements on the
 * mac-local runner are noisier than byte counts (`DRIFT_FAIL_PCT`
 * defaults to 15 here vs 5 in token-cost; revisit once we have baseline
 * stability data per the README's CI promotion path).
 *
 * Re-baseline by running `pnpm bench:latency --update`. The PR diff is
 * the documentation that an optimization landed.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkflowLatency } from "./types.js";

/**
 * Drift tolerance — looser than token-cost's 5% because wall-clock has
 * real run-to-run variance on a mac-local runner. If stability holds
 * for one week of unrelated PR traffic, consider tightening to 10%.
 */
export const DRIFT_FAIL_PCT = 15;

const SNAPSHOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "__snapshots__");
const BASELINE_PATH = resolve(SNAPSHOT_DIR, "baseline.json");

export interface SnapshotPayload {
  /** Advisory — ISO date the snapshot was last regenerated. */
  generatedAt: string;
  workflows: Record<string, WorkflowLatency>;
}

export function buildSnapshot(results: readonly WorkflowLatency[]): SnapshotPayload {
  const workflows: Record<string, WorkflowLatency> = {};
  for (const r of [...results].sort((a, b) => a.workflow.localeCompare(b.workflow))) {
    workflows[r.workflow] = r;
  }
  return { generatedAt: new Date().toISOString().slice(0, 10), workflows };
}

export function readSnapshot(): SnapshotPayload | undefined {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as SnapshotPayload;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export function writeSnapshot(payload: SnapshotPayload): void {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export interface DriftFinding {
  path: string;
  baseline: number;
  current: number;
  driftPct: number;
}

export function diffSnapshots(baseline: SnapshotPayload, current: SnapshotPayload): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const wfNames = new Set([...Object.keys(baseline.workflows), ...Object.keys(current.workflows)]);
  for (const wf of [...wfNames].sort()) {
    const b = baseline.workflows[wf];
    const c = current.workflows[wf];
    if (!b) {
      findings.push({ path: `${wf} (new workflow)`, baseline: 0, current: 1, driftPct: 100 });
      continue;
    }
    if (!c) {
      findings.push({ path: `${wf} (removed workflow)`, baseline: 1, current: 0, driftPct: 100 });
      continue;
    }
    pushIfDrifted(findings, `${wf}.totalDurationMs`, b.totalDurationMs, c.totalDurationMs);
    pushIfDrifted(findings, `${wf}.callCount`, b.callCount, c.callCount);

    // Per-script drift — gate on p95 (overall) and warmP95 since they
    // dominate steady-state user perception. coldP95 is intentionally
    // *not* gated here: single-iteration cold runs are too noisy to
    // assert on; revisit once multi-iteration lands.
    const scriptNames = new Set([...Object.keys(b.byScript), ...Object.keys(c.byScript)]);
    for (const s of [...scriptNames].sort()) {
      const bs = b.byScript[s];
      const cs = c.byScript[s];
      if (!bs || !cs) continue; // script appeared/disappeared — likely a workflow edit, not drift
      pushIfDrifted(findings, `${wf}.${s}.p95Ms`, bs.p95Ms, cs.p95Ms);
      if (bs.warmP95Ms !== null && cs.warmP95Ms !== null) {
        pushIfDrifted(findings, `${wf}.${s}.warmP95Ms`, bs.warmP95Ms, cs.warmP95Ms);
      }
    }
  }
  return findings;
}

function pushIfDrifted(out: DriftFinding[], path: string, baseline: number, current: number): void {
  if (baseline === 0 && current === 0) return;
  const driftPct = baseline === 0 ? 100 : ((current - baseline) / baseline) * 100;
  if (Math.abs(driftPct) >= DRIFT_FAIL_PCT) {
    out.push({ path, baseline, current, driftPct });
  }
}

export function formatDrift(findings: readonly DriftFinding[]): string {
  if (findings.length === 0) return `no drift ≥ ${DRIFT_FAIL_PCT}%`;
  return findings
    .map((f) => {
      const sign = f.driftPct >= 0 ? "+" : "";
      return `  ${f.path}: ${f.baseline} → ${f.current} (${sign}${f.driftPct.toFixed(1)}%)`;
    })
    .join("\n");
}

export const SNAPSHOT_PATH = BASELINE_PATH;
