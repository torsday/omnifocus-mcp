/**
 * Per-tool duration telemetry registry (#798).
 *
 * Sibling of {@link ResponseStatsRegistry} (#778) and
 * {@link LatencyStatsRegistry} (#940): same reservoir-sampled in-process
 * design, same threshold-event pattern. Where responseStats measures
 * wire-bytes per tool and latencyStats measures milliseconds per
 * (transport, script), this aggregator measures milliseconds per **tool**
 * — the wall-clock cost a calling agent observes from `registerTool`'s
 * inner callback (rate-limit + loop-detection + handler + envelope build).
 *
 * Snapshot shape:
 *
 *   {
 *     since: ISO timestamp,
 *     sampleRate: 0..1,
 *     thresholdMs: number,
 *     tools: { [toolName]: { count, max, p50, p95 } },
 *   }
 *
 * Sampling: gated by a sample rate (0–1). At rate 0 the registry is a
 * no-op. Production deploys can dial down to 0.05–0.1 for low overhead
 * while still surfacing outliers.
 *
 * Threshold events: when a tool's p95 transitions across `thresholdMs`,
 * the registry emits a `tool.duration.exceeded` (above) or
 * `tool.duration.recovered` (below) log event. One event per transition.
 *
 * @see #798 — this issue
 * @see #785 / #778 — reference implementation (responseStats)
 * @see #940 — sibling transport-level latency aggregator
 */

import type pino from "pino";

type LoggerLike = Pick<pino.Logger, "warn" | "info">;

/** Default ring-buffer size per tool. */
export const RESERVOIR_SIZE = 1024;

/** Aggregates exposed for one tool. */
export interface ToolDurationStats {
  /** Total invocations recorded since registry start. */
  count: number;
  /** Largest single sample observed (lifetime, not reservoir-bounded). */
  max: number;
  /** 50th percentile across the most recent {@link RESERVOIR_SIZE} samples. */
  p50: number;
  /** 95th percentile across the most recent {@link RESERVOIR_SIZE} samples. */
  p95: number;
}

export interface ToolDurationSnapshot {
  /** ISO timestamp the registry started recording. */
  since: string;
  /** Configured sample rate (0–1). 0 = off; in that case `tools` is empty. */
  sampleRate: number;
  /** Configured p95-ms threshold for `tool.duration.exceeded` events. */
  thresholdMs: number;
  /** Per-tool aggregates, keyed by tool name. */
  tools: Record<string, ToolDurationStats>;
}

export interface ToolDurationStatsOptions {
  /** Sample rate, 0–1. 0 disables recording entirely. */
  sampleRate: number;
  /**
   * p95 ms threshold above which a `tool.duration.exceeded` warning is
   * emitted (once, on the transition above). Set to `Infinity` to disable.
   */
  thresholdMs: number;
  /** Logger for threshold-transition events. */
  logger: LoggerLike;
  /** Override the random source for deterministic tests. */
  random?: () => number;
  /** Override the clock for `since`. */
  now?: () => Date;
  /** Override the reservoir size. */
  reservoirSize?: number;
}

interface ToolState {
  count: number;
  max: number;
  ring: number[];
  cursor: number;
  overThreshold: boolean;
}

/**
 * Registry of per-tool duration aggregates.
 *
 * One instance is constructed at server start; the middleware layer calls
 * {@link record} on every tool invocation (success or error — duration
 * tells the same story either way), and `internal_status` reads
 * {@link snapshot} on demand.
 */
export class ToolDurationStatsRegistry {
  private readonly states = new Map<string, ToolState>();
  private readonly startedAt: Date;
  private readonly random: () => number;
  private readonly reservoirSize: number;

  constructor(private readonly opts: ToolDurationStatsOptions) {
    this.startedAt = (opts.now ?? (() => new Date()))();
    this.random = opts.random ?? Math.random;
    this.reservoirSize = opts.reservoirSize ?? RESERVOIR_SIZE;
  }

  /**
   * Record one tool invocation of `durationMs`. Subject to the configured
   * sample rate — at rate 0 this is an early-return no-op. Non-finite or
   * negative durations are silently skipped (caller bug, but no point
   * crashing observability over a clock anomaly).
   */
  record(toolName: string, durationMs: number): void {
    if (this.opts.sampleRate <= 0) return;
    if (this.opts.sampleRate < 1 && this.random() >= this.opts.sampleRate) return;
    if (!Number.isFinite(durationMs) || durationMs < 0) return;

    let state = this.states.get(toolName);
    if (!state) {
      state = { count: 0, max: 0, ring: [], cursor: 0, overThreshold: false };
      this.states.set(toolName, state);
    }

    state.count += 1;
    if (durationMs > state.max) state.max = durationMs;

    if (state.ring.length < this.reservoirSize) {
      state.ring.push(durationMs);
    } else {
      state.ring[state.cursor] = durationMs;
      state.cursor = (state.cursor + 1) % this.reservoirSize;
    }

    this.checkThreshold(toolName, state);
  }

  snapshot(): ToolDurationSnapshot {
    const tools: Record<string, ToolDurationStats> = {};
    for (const [name, state] of this.states) {
      tools[name] = {
        count: state.count,
        max: state.max,
        p50: percentile(state.ring, 0.5),
        p95: percentile(state.ring, 0.95),
      };
    }
    return {
      since: this.startedAt.toISOString(),
      sampleRate: this.opts.sampleRate,
      thresholdMs: this.opts.thresholdMs,
      tools,
    };
  }

  /** Test helper — drop all recorded state. */
  reset(): void {
    this.states.clear();
  }

  private checkThreshold(toolName: string, state: ToolState): void {
    if (!Number.isFinite(this.opts.thresholdMs)) return;
    if (state.ring.length < 16) return;

    const p95 = percentile(state.ring, 0.95);
    const nowOver = p95 >= this.opts.thresholdMs;

    if (nowOver && !state.overThreshold) {
      this.opts.logger.warn(
        {
          event: "tool.duration.exceeded",
          tool: toolName,
          p95Ms: p95,
          thresholdMs: this.opts.thresholdMs,
          count: state.count,
        },
        "tool duration p95 above threshold",
      );
      state.overThreshold = true;
    } else if (!nowOver && state.overThreshold) {
      this.opts.logger.info(
        {
          event: "tool.duration.recovered",
          tool: toolName,
          p95Ms: p95,
          thresholdMs: this.opts.thresholdMs,
        },
        "tool duration p95 recovered below threshold",
      );
      state.overThreshold = false;
    }
  }
}

/**
 * Linear-interpolated percentile (type 7). Returns 0 for empty input.
 * Does not mutate.
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
