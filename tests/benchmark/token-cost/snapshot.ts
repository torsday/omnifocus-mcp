/**
 * Snapshot read/write/compare for the token-cost benchmark suite (#771).
 *
 * Snapshots are checked-in JSON files that capture the byte counts produced
 * by each fixture workflow on a known-good main. Every CI run rebuilds the
 * counts and compares against the snapshot:
 *
 * - Drift `< {@link DRIFT_FAIL_PCT}` (5%) is treated as fixture noise and
 *   passes silently.
 * - Drift `≥ 5%` in either direction fails the run, printing a diff.
 *
 * Why two-sided? Optimization PRs in #770 *want* to lower bytes; an
 * improvement of ≥ 5% should fail until the PR re-baselines so the change
 * is documented in the diff. Symmetric thresholds also catch regressions
 * a one-sided gate would miss.
 *
 * The snapshot intentionally records only top-level totals + per-tool
 * aggregates — not the full {@link CallRecord} array. Per-call detail
 * fluctuates with adapter-internal ID generation order; the totals do not.
 *
 * Re-baseline by running `pnpm bench:tokens --update`. The script writes
 * the current run to `__snapshots__/baseline.json`. The PR diff that
 * results is the documentation.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkflowResult } from "./runBench.js";

export const DRIFT_FAIL_PCT = 5;

const SNAPSHOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "__snapshots__");
const BASELINE_PATH = resolve(SNAPSHOT_DIR, "baseline.json");

/** Persisted shape — totals only, sorted by workflow name for stable diffs. */
export interface SnapshotPayload {
  /** ISO date the snapshot was last regenerated; advisory. */
  generatedAt: string;
  /** Tools/list payload bytes — workflow-independent. */
  toolListBytes: number;
  /** Per-workflow totals, keyed by workflow name. */
  workflows: Record<
    string,
    {
      callCount: number;
      totalRequestBytes: number;
      totalResponseBytes: number;
      totalRoundTripBytes: number;
      totalTokens: number;
      byTool: Record<string, { calls: number; responseBytes: number }>;
    }
  >;
}

export function buildSnapshot(results: WorkflowResult[]): SnapshotPayload {
  const sorted = [...results].sort((a, b) => a.workflow.localeCompare(b.workflow));
  const toolListBytes = sorted[0]?.toolListBytes ?? 0;
  const workflows: SnapshotPayload["workflows"] = {};
  for (const r of sorted) {
    const sortedByTool: Record<string, { calls: number; responseBytes: number }> = {};
    for (const [k, v] of Object.entries(r.byTool).sort(([a], [b]) => a.localeCompare(b))) {
      sortedByTool[k] = v;
    }
    workflows[r.workflow] = {
      callCount: r.callCount,
      totalRequestBytes: r.totalRequestBytes,
      totalResponseBytes: r.totalResponseBytes,
      totalRoundTripBytes: r.totalRoundTripBytes,
      totalTokens: r.totalTokens,
      byTool: sortedByTool,
    };
  }
  return { generatedAt: new Date().toISOString().slice(0, 10), toolListBytes, workflows };
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

/** Compare two snapshots, reporting any field whose drift exceeds the threshold. */
export function diffSnapshots(baseline: SnapshotPayload, current: SnapshotPayload): DriftFinding[] {
  const findings: DriftFinding[] = [];
  pushIfDrifted(findings, "toolListBytes", baseline.toolListBytes, current.toolListBytes);

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
    pushIfDrifted(findings, `${wf}.callCount`, b.callCount, c.callCount);
    pushIfDrifted(findings, `${wf}.totalRequestBytes`, b.totalRequestBytes, c.totalRequestBytes);
    pushIfDrifted(findings, `${wf}.totalResponseBytes`, b.totalResponseBytes, c.totalResponseBytes);
    pushIfDrifted(
      findings,
      `${wf}.totalRoundTripBytes`,
      b.totalRoundTripBytes,
      c.totalRoundTripBytes,
    );
    pushIfDrifted(findings, `${wf}.totalTokens`, b.totalTokens, c.totalTokens);
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

export function formatDrift(findings: DriftFinding[]): string {
  if (findings.length === 0) return "no drift ≥ 5%";
  return findings
    .map((f) => {
      const sign = f.driftPct >= 0 ? "+" : "";
      return `  ${f.path}: ${f.baseline} → ${f.current} (${sign}${f.driftPct.toFixed(1)}%)`;
    })
    .join("\n");
}

export const SNAPSHOT_PATH = BASELINE_PATH;
