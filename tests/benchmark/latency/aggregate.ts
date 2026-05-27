/**
 * Aggregation — turn raw {@link ScriptCallEvent} streams into per-workflow
 * latency rollups (#941).
 *
 * Cold-vs-warm split rule:
 *   For each `scriptName` within a workflow run, the *first* observed
 *   event is cold (it pays the osascript spawn floor); everything after
 *   is warm. Unannotated calls (`scriptName === undefined`) aggregate
 *   under the `__unknown__` key — they should not exist for production
 *   call sites, but the bucket prevents data loss if a new code path
 *   forgets to pass `scriptName`.
 *
 * Single-iteration caveat:
 *   With one worker process per workflow (current design), `coldP95` is
 *   a single-sample percentile — it equals the one cold call's wall-
 *   clock. The shape is forward-compatible with multi-iteration runs
 *   (just feed N iterations of events into one aggregator); the
 *   follow-up issue for multi-iteration nets that.
 */

import { max, percentile } from "./percentiles.js";
import type { ScriptCallEvent, ScriptLatency, WorkflowLatency } from "./types.js";

const UNKNOWN_SCRIPT_KEY = "__unknown__";

interface Buckets {
  all: number[];
  cold: number[];
  warm: number[];
}

/** Build a per-workflow rollup from the worker's raw event stream. */
export function aggregateWorkflow(
  workflow: string,
  events: readonly ScriptCallEvent[],
): WorkflowLatency {
  const byScript: Record<string, Buckets> = {};
  const seen = new Set<string>();
  let totalDurationMs = 0;
  let totalSpawnFloorMs = 0;
  let spawnSamples = 0;

  // Sort by sequence to make cold detection deterministic — the recorder
  // assigns sequence numbers in the order events arrive at the listener,
  // so the first observed scriptName is cold.
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  for (const e of ordered) {
    const key = e.scriptName ?? UNKNOWN_SCRIPT_KEY;
    let bucket = byScript[key];
    if (bucket === undefined) {
      bucket = { all: [], cold: [], warm: [] };
      byScript[key] = bucket;
    }
    bucket.all.push(e.durationMs);
    if (seen.has(key)) {
      bucket.warm.push(e.durationMs);
    } else {
      bucket.cold.push(e.durationMs);
      seen.add(key);
    }
    totalDurationMs += e.durationMs;
    if (e.spawnFloorMs !== undefined) {
      totalSpawnFloorMs += e.spawnFloorMs;
      spawnSamples += 1;
    }
  }

  const byScriptOut: Record<string, ScriptLatency> = {};
  for (const key of Object.keys(byScript).sort()) {
    const b = byScript[key]!;
    byScriptOut[key] = {
      count: b.all.length,
      p50Ms: round(percentile(b.all, 0.5)),
      p95Ms: round(percentile(b.all, 0.95)),
      maxMs: round(max(b.all)),
      coldP95Ms: round(percentile(b.cold, 0.95)),
      // `null` when no warm samples — preserves the distinction from "0ms warm".
      warmP95Ms: b.warm.length === 0 ? null : round(percentile(b.warm, 0.95)),
    };
  }

  // Spawn share: average spawnFloor (over samples that had it) × call count
  // ÷ total duration. Falls back to 0 if calibration never reported (the
  // README documents how to read that).
  const spawnShare =
    spawnSamples === 0 || totalDurationMs === 0
      ? 0
      : (totalSpawnFloorMs / spawnSamples) * spawnSamples;
  const spawnPctOfTotal =
    totalDurationMs === 0 ? 0 : round((spawnShare / totalDurationMs) * 100, 1);

  return {
    workflow,
    totalDurationMs: round(totalDurationMs),
    spawnPctOfTotal,
    callCount: ordered.length,
    byScript: byScriptOut,
  };
}

/** Round to the nearest 0.1ms by default — keeps snapshots stable across runs while preserving useful detail. */
function round(n: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}
