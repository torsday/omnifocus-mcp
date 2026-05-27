/**
 * Shared types for the latency benchmark harness (#941).
 *
 * The harness records one event per `runJxaScript` / `runOmniJsScript`
 * invocation (via {@link onTransportCall}) and aggregates them into a
 * per-workflow per-script latency picture. Sister to
 * `tests/benchmark/token-cost/` — same audience, same baseline policy,
 * but measuring wall-clock instead of wire bytes.
 *
 * @see tests/benchmark/latency/README.md — measurement contract, baseline policy
 */

/** One raw measurement, captured by {@link Recorder} via `onTransportCall`. */
export interface ScriptCallEvent {
  /** Which transport produced the call (mirrors the log field). */
  transport: "jxa" | "omnijs";
  /** Script name (e.g. `task_list`, `project_create`). Undefined for unannotated calls. */
  scriptName: string | undefined;
  /** Total wall-clock for the call: spawn + script execution + transport overhead. */
  durationMs: number;
  /** Calibrated osascript spawn floor at the time of the call. Absent until calibration completes. */
  spawnFloorMs?: number;
  outcome: "ok" | "error";
  /** Order of arrival within the workflow run — stable for cold/warm split. */
  sequence: number;
}

/** Aggregated picture for one (workflow, script) pair. */
export interface ScriptLatency {
  /** Total calls observed in the workflow. */
  count: number;
  /** Wall-clock p50 across all calls. */
  p50Ms: number;
  /** Wall-clock p95 across all calls. */
  p95Ms: number;
  /** Wall-clock max across all calls. */
  maxMs: number;
  /**
   * p95 of cold calls — the *first* invocation of this script in the
   * workflow's process. With one iteration per workflow, this is a
   * single value (cold p95 == cold max == the cold call's wall-clock).
   * Repeating the workflow N times across worker processes turns this
   * into a true p95; deferred until the multi-iteration follow-up.
   */
  coldP95Ms: number;
  /**
   * p95 of warm calls — every invocation *after* the first. `null` when
   * the workflow calls this script exactly once (no warm samples).
   */
  warmP95Ms: number | null;
}

/** Per-workflow rollup. */
export interface WorkflowLatency {
  /** Workflow name (e.g. `inbox-triage`, matches the token-cost workflow id). */
  workflow: string;
  /** Sum of every call's `durationMs` (jxa + omnijs combined). */
  totalDurationMs: number;
  /**
   * `sum(spawnFloorMs * count) / sum(durationMs)`. When no spawnFloor is
   * available (calibration didn't complete), reports `0` — operators
   * should read that as "spawn share unknown for this run", not "spawn
   * is 0% of cost".
   */
  spawnPctOfTotal: number;
  /** Total call count across all scripts. */
  callCount: number;
  /** Per-script measurements, keyed by `scriptName`. Unannotated calls aggregate under `__unknown__`. */
  byScript: Record<string, ScriptLatency>;
}

/** What a worker process emits to stdout. Always a JSON-encoded `WorkerOutput`. */
export interface WorkerOutput {
  workflow: string;
  /** Wall-clock cost of the workflow body inside the worker. */
  workflowDurationMs: number;
  /** Raw events — the parent aggregates. */
  events: ScriptCallEvent[];
  /** Workflow setup or teardown errors propagated as a string for the parent to log. */
  error?: string;
}
