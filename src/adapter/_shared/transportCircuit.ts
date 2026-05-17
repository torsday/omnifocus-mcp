/**
 * Transport-level circuit breaker (#835).
 *
 * Distinct from the per-tool {@link CircuitBreakerRegistry} that lives in
 * `src/server/circuitBreaker.ts` and is invoked by the per-tool middleware.
 * That breaker scopes failures by tool name — useful when a single tool
 * (say, `forecast_get`) is breaking but the rest of the system is healthy.
 * This breaker scopes failures by *transport* (JXA vs OmniJS) — useful when
 * OmniFocus itself enters a sustained bad state (corrupt sync, hung
 * database, app crash) and *every* tool calling that transport pays the
 * 30s timeout one after another.
 *
 * State machine:
 *
 *   closed ──────[N consecutive transient failures]──────▶ open
 *      ▲                                                    │
 *      │                                                    │
 *      │ [probe success]                       [recoveryMs elapsed]
 *      │                                                    │
 *      │                                                    ▼
 *      └─[probe failure → open w/ fresh timer]──── half-open
 *
 * Permanent failures (validation errors, missing-application,
 * malformed-JSON, etc.) DO NOT contribute to the consecutive-failure
 * count — only signals on the same "transient" axis as the retry-once
 * policy (#816). A `ScriptError` from a logic bug shouldn't trip the
 * breaker; a flurry of `Timeout`s should.
 *
 * @see #835 — this issue
 * @see #816 — retry-once on transient failures (closed)
 * @see src/adapter/_shared/retryPolicy.ts — the sibling transient-control surface
 * @see src/errors/index.ts — `CircuitOpen` is reused for the surface error
 */

import type pino from "pino";
import { CircuitOpen, OmniFocusNotRunning, Timeout } from "../../errors/index.js";

/**
 * Predicate: should this thrown error count as a "transient" failure
 * for circuit-breaker purposes?
 *
 * The bar is intentionally narrower than the retry-once classifier: only
 * the signals that mean "OmniFocus itself is sick" — timeouts on the
 * transport (sustained OF wedge) and explicit "OF isn't running" failures.
 * Logic bugs (ScriptError), validation, missing-application-binary,
 * permission denials, etc. are permanent and must not pollute the
 * consecutive-failure counter.
 */
export function isCircuitTransient(err: unknown): boolean {
  return err instanceof Timeout || err instanceof OmniFocusNotRunning;
}

type LoggerLike = Pick<pino.Logger, "warn" | "info">;

export type Transport = "jxa" | "omnijs";

/** Public configuration knobs. */
export interface TransportCircuitOptions {
  /** Consecutive transient failures before the breaker opens. */
  threshold: number;
  /** Milliseconds to remain open before half-opening for a probe. */
  recoveryMs: number;
  /** Master switch; when false the breaker is a no-op. */
  enabled: boolean;
  /** Logger for state-transition events. */
  logger: LoggerLike;
  /** Override the clock for deterministic tests. Default `Date.now`. */
  now?: () => number;
}

type State = "closed" | "open" | "half-open";

/**
 * Per-transport circuit breaker. One instance per transport; shared across
 * every script call through that transport. Stateful — constructed at
 * module load (see `getJxaCircuit()` / `getOmniJsCircuit()`).
 */
export class TransportCircuit {
  private state: State = "closed";
  private failureCount = 0;
  /** Wall-clock time the breaker opened (`now()`). */
  private openedAt = 0;
  private readonly now: () => number;

  constructor(
    private readonly transport: Transport,
    private readonly opts: TransportCircuitOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  /** Test/inspection helper — current state, never mutated by callers. */
  inspect(): { state: State; failureCount: number; openedAt: number } {
    return { state: this.state, failureCount: this.failureCount, openedAt: this.openedAt };
  }

  /**
   * Run a transport call through the breaker. Throws {@link CircuitOpen}
   * immediately when open (without invoking `fn`); otherwise calls `fn` and
   * classifies its outcome via `isTransientError`.
   *
   * `isTransientError` must return `true` only for the signal classes that
   * indicate OmniFocus itself is sick (timeouts, the same JXA error
   * patterns the retry-policy treats as retryable). Permanent failures
   * (logic bugs, validation errors, missing-application) must return
   * `false` so they don't pollute the failure counter.
   */
  async tryCall<T>(fn: () => Promise<T>, isTransientError: (err: unknown) => boolean): Promise<T> {
    if (!this.opts.enabled) {
      return fn();
    }

    if (this.state === "open") {
      const elapsed = this.now() - this.openedAt;
      if (elapsed < this.opts.recoveryMs) {
        throw this.openError(elapsed);
      }
      // Recovery window elapsed — half-open and let this call probe.
      this.transition("half-open", "recovery-window-elapsed");
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure(isTransientError(err));
      throw err;
    }
  }

  /** Test helper — reset to closed. Not used in production. */
  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.openedAt = 0;
  }

  private recordSuccess(): void {
    if (this.state === "half-open") {
      this.transition("closed", "probe-succeeded");
    }
    this.failureCount = 0;
  }

  private recordFailure(isTransient: boolean): void {
    if (!isTransient) {
      // Permanent failures don't count toward the consecutive-failure
      // budget. We also do NOT reset the counter — a single permanent
      // failure mid-burst shouldn't paper over an actual outage.
      return;
    }

    if (this.state === "half-open") {
      // Probe failed — back to open with a fresh recovery timer.
      this.transition("open", "probe-failed");
      return;
    }

    this.failureCount += 1;
    if (this.failureCount >= this.opts.threshold) {
      this.transition("open", `${this.opts.threshold}-consecutive-failures`);
    }
  }

  private transition(next: State, reason: string): void {
    const prev = this.state;
    this.state = next;

    if (next === "open") {
      this.openedAt = this.now();
      this.opts.logger.warn(
        {
          event: "transport.circuit.opened",
          transport: this.transport,
          reason,
          recoveryMs: this.opts.recoveryMs,
          threshold: this.opts.threshold,
          previousState: prev,
        },
        "transport circuit opened",
      );
    } else if (next === "closed") {
      this.opts.logger.info(
        {
          event: "transport.circuit.closed",
          transport: this.transport,
          reason,
          previousState: prev,
        },
        "transport circuit closed",
      );
      this.failureCount = 0;
    }
  }

  private openError(elapsedMs: number): CircuitOpen {
    const retryAfterMs = Math.max(0, this.opts.recoveryMs - elapsedMs);
    return new CircuitOpen(
      `${this.transport.toUpperCase()} transport circuit is open after ${this.opts.threshold} consecutive failures`,
      {
        details: {
          transport: this.transport,
          retryAfterMs,
          threshold: this.opts.threshold,
        },
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Module-level instances
// ---------------------------------------------------------------------------
//
// Mirrors the retry-policy module: one global per transport with defaults
// applied at import time, mutable once at boot via `configureTransportCircuits`.
// The runners reach for the shared instance rather than threading it through
// every call site.

const DEFAULTS: Omit<TransportCircuitOptions, "logger"> = {
  threshold: 5,
  recoveryMs: 30_000,
  enabled: true,
};

let jxaCircuit: TransportCircuit | null = null;
let omniJsCircuit: TransportCircuit | null = null;

/**
 * Apply configuration once at server boot. Subsequent calls re-create the
 * circuits with the new options (any in-flight state is discarded — only
 * call this before the server starts handling requests).
 */
export function configureTransportCircuits(
  opts: Partial<Omit<TransportCircuitOptions, "logger">> & { logger: LoggerLike },
): void {
  const full: TransportCircuitOptions = { ...DEFAULTS, ...opts };
  jxaCircuit = new TransportCircuit("jxa", full);
  omniJsCircuit = new TransportCircuit("omnijs", full);
}

/** Lazily-initialised module-level circuit for the JXA transport. */
export function getJxaCircuit(): TransportCircuit {
  if (jxaCircuit === null) {
    // Default to a no-op logger if `configureTransportCircuits` was never
    // called — tests and one-shot CLI invocations sometimes reach the
    // runner without booting the full server.
    jxaCircuit = new TransportCircuit("jxa", { ...DEFAULTS, logger: silentLogger() });
  }
  return jxaCircuit;
}

/** Lazily-initialised module-level circuit for the OmniJS transport. */
export function getOmniJsCircuit(): TransportCircuit {
  if (omniJsCircuit === null) {
    omniJsCircuit = new TransportCircuit("omnijs", { ...DEFAULTS, logger: silentLogger() });
  }
  return omniJsCircuit;
}

/** Test-only — reset both module-level circuits to closed. */
export function __resetTransportCircuitsForTest(): void {
  jxaCircuit?.reset();
  omniJsCircuit?.reset();
}

function silentLogger(): LoggerLike {
  return {
    warn: () => undefined,
    info: () => undefined,
  } as LoggerLike;
}
