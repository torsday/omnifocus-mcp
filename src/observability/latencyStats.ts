/**
 * Per-transport / per-script latency telemetry registry (#940, part of the
 * observability layer that already includes {@link ResponseStatsRegistry}
 * for response sizes).
 *
 * Captures each `transport.call` event's `scriptMs` (the duration of the
 * actual osascript execution, minus the spawn floor calibrated by #939).
 * Where `scriptMs` is unavailable — typically during the first calls in a
 * process while calibration is still in flight — falls back to `durationMs`.
 *
 * Snapshot shape (per the issue):
 *
 *   {
 *     since: ISO timestamp,
 *     sampleRate: 0..1,
 *     thresholdMs: number,
 *     transports: {
 *       jxa:    { spawnFloorMs, scripts: { [name]: { count, p50, p95, max } } },
 *       omnijs: { spawnFloorMs, scripts: { [name]: { count, p50, p95, max } } },
 *     },
 *   }
 *
 * The registry is fed at composition time via {@link onTransportCall} (see
 * `src/logging/transportCall.ts`) — the script runners stay free of
 * observability dependencies; observability subscribes from the outside.
 *
 * Memory bound: a small ring buffer of recent samples per (transport,
 * script). Percentiles are computed against the buffer at snapshot time
 * — "what's slow right now?" semantics, not all-time.
 *
 * Threshold events: when a script's p95 transitions across `thresholdMs`,
 * the registry emits a `latency.exceeded` (above) or `latency.recovered`
 * (below) log event. One event per transition, not one per call.
 *
 * @see #940 — this issue
 * @see #939 — spawn-vs-script split
 * @see src/observability/responseStats.ts — sibling aggregator for bytes
 */

import type pino from "pino";

type LoggerLike = Pick<pino.Logger, "warn" | "info">;

export type Transport = "jxa" | "omnijs";

/** Default ring-buffer size per (transport, script). */
export const RESERVOIR_SIZE = 1024;

/** Aggregates exposed for one (transport, script) pair. */
export interface ScriptLatencyStats {
  /** Total invocations recorded since registry start. */
  count: number;
  /** Largest single sample observed (lifetime, not reservoir-bounded). */
  max: number;
  /** 50th percentile across the most recent {@link RESERVOIR_SIZE} samples. */
  p50: number;
  /** 95th percentile across the most recent {@link RESERVOIR_SIZE} samples. */
  p95: number;
}

/** Per-transport block in the snapshot. */
export interface TransportLatencyStats {
  /**
   * The calibrated osascript spawn-floor (#939) at snapshot time. Reported
   * here so operators can interpret `scriptMs` correctly without flipping
   * to a separate probe. `null` while calibration is still in flight.
   */
  spawnFloorMs: number | null;
  /** Per-script aggregates, keyed by `scriptName`. */
  scripts: Record<string, ScriptLatencyStats>;
}

export interface LatencyStatsSnapshot {
  /** ISO timestamp the registry started recording. */
  since: string;
  /** Configured sample rate (0–1). 0 = off; in that case `transports` is empty. */
  sampleRate: number;
  /** Configured p95-ms threshold for `latency.exceeded` events. */
  thresholdMs: number;
  transports: Record<Transport, TransportLatencyStats>;
}

/** Construction options. */
export interface LatencyStatsOptions {
  /** Sample rate, 0–1. 0 disables recording entirely. */
  sampleRate: number;
  /**
   * p95 ms threshold above which a `latency.exceeded` warning is emitted
   * (once, on the transition above). Set to `Infinity` to disable.
   */
  thresholdMs: number;
  /** Logger for threshold-transition events. */
  logger: LoggerLike;
  /**
   * Lazy accessor for the calibrated spawn floor. Defaults to a getter
   * that returns `null`; in production the composition layer wires this
   * to `getSpawnFloorMs()`.
   */
  getSpawnFloorMs?: (transport: Transport) => number | null;
  /** Override the random source for deterministic tests. */
  random?: () => number;
  /** Override the clock for `since`. */
  now?: () => Date;
  /** Override the reservoir size. */
  reservoirSize?: number;
}

/** Per-(transport, script) internal state. */
interface ScriptState {
  count: number;
  max: number;
  ring: number[];
  cursor: number;
  overThreshold: boolean;
}

const TRANSPORTS: readonly Transport[] = ["jxa", "omnijs"];

/**
 * Registry of per-transport / per-script latency aggregates.
 *
 * One instance is constructed at server start; the composition layer
 * subscribes it to `transport.call` events via {@link onTransportCall},
 * and `internal_status` reads {@link snapshot} on demand.
 */
export class LatencyStatsRegistry {
  private readonly states: Map<Transport, Map<string, ScriptState>> = new Map([
    ["jxa", new Map()],
    ["omnijs", new Map()],
  ]);
  private readonly startedAt: Date;
  private readonly random: () => number;
  private readonly reservoirSize: number;
  private readonly getSpawnFloor: (transport: Transport) => number | null;

  constructor(private readonly opts: LatencyStatsOptions) {
    this.startedAt = (opts.now ?? (() => new Date()))();
    this.random = opts.random ?? Math.random;
    this.reservoirSize = opts.reservoirSize ?? RESERVOIR_SIZE;
    this.getSpawnFloor = opts.getSpawnFloorMs ?? (() => null);
  }

  /**
   * Record one `transport.call` observation. `scriptMs` is preferred when
   * present (the #939 split); otherwise fall back to `durationMs` so we
   * still capture coarse latency while spawn-floor calibration is in
   * flight. The choice is per-sample — early-process calls are slightly
   * over-counted by the spawn cost, which is acceptable for the
   * "what's slow right now?" probe semantics.
   *
   * Events with no `scriptName` are recorded under the synthetic key
   * `"(unnamed)"` rather than dropped — anonymous calls are still
   * meaningful for transport-level latency. Failures (`outcome: "error"`)
   * are also recorded; latency tells you the same story whether the call
   * succeeded or not.
   */
  record(args: {
    transport: Transport;
    scriptName: string | undefined;
    durationMs: number;
    scriptMs?: number;
  }): void {
    if (this.opts.sampleRate <= 0) return;
    if (this.opts.sampleRate < 1 && this.random() >= this.opts.sampleRate) return;

    const ms = args.scriptMs ?? args.durationMs;
    if (!Number.isFinite(ms) || ms < 0) return;

    const scripts = this.states.get(args.transport);
    if (!scripts) return;
    const key = args.scriptName ?? "(unnamed)";

    let state = scripts.get(key);
    if (!state) {
      state = { count: 0, max: 0, ring: [], cursor: 0, overThreshold: false };
      scripts.set(key, state);
    }

    state.count += 1;
    if (ms > state.max) state.max = ms;

    if (state.ring.length < this.reservoirSize) {
      state.ring.push(ms);
    } else {
      state.ring[state.cursor] = ms;
      state.cursor = (state.cursor + 1) % this.reservoirSize;
    }

    this.checkThreshold(args.transport, key, state);
  }

  snapshot(): LatencyStatsSnapshot {
    const transports = {} as Record<Transport, TransportLatencyStats>;
    for (const t of TRANSPORTS) {
      const scriptsState = this.states.get(t) ?? new Map<string, ScriptState>();
      const scripts: Record<string, ScriptLatencyStats> = {};
      for (const [name, state] of scriptsState) {
        scripts[name] = {
          count: state.count,
          max: state.max,
          p50: percentile(state.ring, 0.5),
          p95: percentile(state.ring, 0.95),
        };
      }
      transports[t] = {
        spawnFloorMs: this.getSpawnFloor(t),
        scripts,
      };
    }
    return {
      since: this.startedAt.toISOString(),
      sampleRate: this.opts.sampleRate,
      thresholdMs: this.opts.thresholdMs,
      transports,
    };
  }

  /** Test helper — drop all recorded state. */
  reset(): void {
    for (const m of this.states.values()) m.clear();
  }

  private checkThreshold(transport: Transport, scriptName: string, state: ScriptState): void {
    if (!Number.isFinite(this.opts.thresholdMs)) return;
    // Suppress noisy early evaluation while the reservoir is still small.
    if (state.ring.length < 16) return;

    const p95 = percentile(state.ring, 0.95);
    const nowOver = p95 >= this.opts.thresholdMs;

    if (nowOver && !state.overThreshold) {
      this.opts.logger.warn(
        {
          event: "latency.exceeded",
          transport,
          scriptName,
          p95Ms: p95,
          thresholdMs: this.opts.thresholdMs,
          count: state.count,
        },
        "transport script p95 latency above threshold",
      );
      state.overThreshold = true;
    } else if (!nowOver && state.overThreshold) {
      this.opts.logger.info(
        {
          event: "latency.recovered",
          transport,
          scriptName,
          p95Ms: p95,
          thresholdMs: this.opts.thresholdMs,
        },
        "transport script p95 latency recovered below threshold",
      );
      state.overThreshold = false;
    }
  }
}

/**
 * Linear-interpolated percentile across a numeric array (type 7).
 * Returns 0 for an empty input. Does not mutate.
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
