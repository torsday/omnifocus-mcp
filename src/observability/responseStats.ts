/**
 * Per-tool response-byte telemetry registry (#778, part of #770).
 *
 * Records the wire size of each successful tool response so operators can see
 * which tools dominate token cost in real production workloads — orthogonal
 * to the offline benchmark suite (#771), which measures fixed fixtures. The
 * benchmark catches regressions on canonical workflows; this catches the
 * tools that real sessions actually beat on.
 *
 * Aggregates exposed per tool: `count`, `total`, `max`, `p50`, `p95`,
 * plus a `since` timestamp so callers can compute "rate per minute" without
 * a separate clock.
 *
 * Memory bound: a small ring buffer of recent samples per tool (default
 * {@link RESERVOIR_SIZE}). Percentiles are computed against the buffer at
 * snapshot time — they reflect *recent* behaviour, not all-time, which is
 * the right semantics for a "what's expensive right now?" probe.
 *
 * Sampling: gated by a sample rate (0–1). At rate 0 the registry is a
 * no-op. At rate 1 every call is recorded. Production deploys can dial
 * down to 0.05–0.1 for low overhead while still surfacing outliers.
 *
 * Threshold events: when a tool's p95 transitions across a configured
 * byte threshold, the registry emits a `response.size.exceeded` (above) or
 * `response.size.recovered` (below) log event. One event per transition,
 * not one per call — operators see signal, not noise.
 *
 * @see #770 — token-efficiency epic
 * @see #771 — benchmark suite (orthogonal — fixed fixtures)
 */

import type pino from "pino";

/** Narrow logger surface this registry consumes — `warn` for transitions above, `info` for recoveries. */
type LoggerLike = Pick<pino.Logger, "warn" | "info">;

/** Default ring-buffer size per tool. 1024 samples → exact percentiles up to ~1k recent calls. */
export const RESERVOIR_SIZE = 1024;

/**
 * Aggregates exposed for one tool. All byte counts are wire-size of the
 * `structuredContent` envelope as JSON. `count` and `total` are not capped
 * by the reservoir — they accumulate across the lifetime of the registry.
 * `p50` / `p95` / `max` are computed against the most recent
 * {@link RESERVOIR_SIZE} samples.
 *
 * `null` when the tool has no recorded samples yet.
 */
export interface ToolResponseStats {
  /** Total successful invocations recorded since registry start. */
  count: number;
  /** Sum of recorded bytes since registry start. */
  total: number;
  /** Largest single sample observed (lifetime, not reservoir-bounded). */
  max: number;
  /** 50th percentile across the most recent {@link RESERVOIR_SIZE} samples. */
  p50: number;
  /** 95th percentile across the most recent {@link RESERVOIR_SIZE} samples. */
  p95: number;
}

/** Snapshot returned by {@link ResponseStatsRegistry.snapshot}. */
export interface ResponseStatsSnapshot {
  /** ISO timestamp the registry started recording (process start). */
  since: string;
  /** Per-tool aggregates, keyed by tool name. */
  tools: Record<string, ToolResponseStats>;
  /** Configured sample rate (0–1). 0 = off; in that case `tools` is empty. */
  sampleRate: number;
  /** Configured byte threshold for p95-exceeded events. */
  thresholdBytes: number;
}

/** Construction options for {@link ResponseStatsRegistry}. */
export interface ResponseStatsOptions {
  /** Sample rate, 0–1. 0 disables recording entirely. */
  sampleRate: number;
  /**
   * p95 byte threshold above which a `response.size.exceeded` warning is
   * emitted (once, on the transition above). Set to `Infinity` to disable.
   */
  thresholdBytes: number;
  /** Logger for threshold-transition events. */
  logger: LoggerLike;
  /** Override the random source — set for deterministic tests. */
  random?: () => number;
  /** Override the clock for `since`. Defaults to `new Date()`. */
  now?: () => Date;
  /** Override the reservoir size. Defaults to {@link RESERVOIR_SIZE}. */
  reservoirSize?: number;
}

/** Per-tool internal state. */
interface ToolState {
  count: number;
  total: number;
  max: number;
  /** Ring buffer of recent byte samples. Length grows up to `reservoirSize`. */
  ring: number[];
  /** Next write position in the ring buffer (mod reservoirSize). */
  cursor: number;
  /** Whether the most recent p95 was above threshold — for transition detection. */
  overThreshold: boolean;
}

/**
 * Registry of per-tool response-size aggregates.
 *
 * One instance is constructed at server start; the middleware layer calls
 * {@link record} on every successful tool response, and {@link internal_status}
 * reads {@link snapshot} on demand.
 */
export class ResponseStatsRegistry {
  private readonly states = new Map<string, ToolState>();
  private readonly startedAt: Date;
  private readonly random: () => number;
  private readonly reservoirSize: number;

  constructor(private readonly opts: ResponseStatsOptions) {
    this.startedAt = (opts.now ?? (() => new Date()))();
    this.random = opts.random ?? Math.random;
    this.reservoirSize = opts.reservoirSize ?? RESERVOIR_SIZE;
  }

  /**
   * Record a successful tool response of `bytes` size. Subject to the
   * configured sample rate — at rate 0 this is an early-return no-op. The
   * sample decision is per-call; aggregates remain unbiased provided
   * `sampleRate > 0`.
   *
   * `count` and `total` only increment when the call is sampled, so they
   * track the *recorded* population, not the underlying invocation rate.
   * That matters for memory bounds (no need to count every call when off)
   * and for keeping snapshot semantics consistent (the reported aggregates
   * always describe the same set of samples).
   */
  record(toolName: string, bytes: number): void {
    if (this.opts.sampleRate <= 0) return;
    if (this.opts.sampleRate < 1 && this.random() >= this.opts.sampleRate) return;
    if (!Number.isFinite(bytes) || bytes < 0) return;

    let state = this.states.get(toolName);
    if (!state) {
      state = { count: 0, total: 0, max: 0, ring: [], cursor: 0, overThreshold: false };
      this.states.set(toolName, state);
    }

    state.count += 1;
    state.total += bytes;
    if (bytes > state.max) state.max = bytes;

    if (state.ring.length < this.reservoirSize) {
      state.ring.push(bytes);
    } else {
      state.ring[state.cursor] = bytes;
      state.cursor = (state.cursor + 1) % this.reservoirSize;
    }

    this.checkThreshold(toolName, state);
  }

  /**
   * Return the current aggregates. Computing percentiles requires sorting
   * each tool's reservoir; cost is O(n log n) where n ≤ reservoirSize, so
   * for the default 1024 it's well under a millisecond per snapshot.
   */
  snapshot(): ResponseStatsSnapshot {
    const tools: Record<string, ToolResponseStats> = {};
    for (const [name, state] of this.states) {
      tools[name] = {
        count: state.count,
        total: state.total,
        max: state.max,
        p50: percentile(state.ring, 0.5),
        p95: percentile(state.ring, 0.95),
      };
    }
    return {
      since: this.startedAt.toISOString(),
      tools,
      sampleRate: this.opts.sampleRate,
      thresholdBytes: this.opts.thresholdBytes,
    };
  }

  /** Test helper — drop all recorded state. Not used in production. */
  reset(): void {
    this.states.clear();
  }

  /**
   * Check whether p95 has crossed `thresholdBytes` since the last record;
   * emit at most one event per transition.
   */
  private checkThreshold(toolName: string, state: ToolState): void {
    if (!Number.isFinite(this.opts.thresholdBytes)) return;
    // p95 over a too-small reservoir is noisy — wait until we have a
    // meaningful sample (16) before evaluating transitions.
    if (state.ring.length < 16) return;

    const p95 = percentile(state.ring, 0.95);
    const nowOver = p95 >= this.opts.thresholdBytes;

    if (nowOver && !state.overThreshold) {
      this.opts.logger.warn(
        {
          event: "response.size.exceeded",
          tool: toolName,
          p95Bytes: p95,
          thresholdBytes: this.opts.thresholdBytes,
          count: state.count,
        },
        "tool response p95 above threshold",
      );
      state.overThreshold = true;
    } else if (!nowOver && state.overThreshold) {
      this.opts.logger.info(
        {
          event: "response.size.recovered",
          tool: toolName,
          p95Bytes: p95,
          thresholdBytes: this.opts.thresholdBytes,
        },
        "tool response p95 recovered below threshold",
      );
      state.overThreshold = false;
    }
  }
}

/**
 * Linear-interpolated percentile across a numeric array. Returns 0 for an
 * empty input (callers should guard, but a defined result is friendlier than
 * NaN). The input is not mutated.
 *
 * Uses the "type 7" definition (Excel/numpy default): rank = q * (n - 1).
 */
function percentile(samples: readonly number[], q: number): number {
  if (samples.length === 0) return 0;
  if (samples.length === 1) return samples[0] ?? 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = q * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo] ?? 0;
  const loVal = sorted[lo] ?? 0;
  const hiVal = sorted[hi] ?? 0;
  return loVal + (hiVal - loVal) * (rank - lo);
}

/** Exported for unit tests only. */
export const __testing = { percentile };
