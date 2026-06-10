/**
 * Per-tool circuit breaker for omnifocus-mcp.
 *
 * Implements a standard closed → open → half-open state machine per
 * DESIGN §6.10 and `agent_systems.md` (fail-fast, actionable errors):
 *
 *   CLOSED   — normal operation; failures are counted within a rolling window.
 *   OPEN     — fast-fails with `CircuitOpen`; entered after threshold failures.
 *   HALF_OPEN — allows a single probe call; success → CLOSED, failure → OPEN.
 *
 * Default thresholds (overridable via constructor options for testing):
 *   - failureThreshold: 3 consecutive failures within windowMs (60 s)
 *   - openDurationMs: 60 s before transitioning to HALF_OPEN
 *
 * Observability: `circuit.opened` and `circuit.closed` log events are emitted
 * on every state transition per DESIGN §21.
 *
 * Usage:
 *   const breaker = registry.get("task_list");
 *   await breaker.call(() => transport.taskList(params));
 *
 * @see DESIGN.md §6.10 — circuit breaker specification
 * @see src/errors/index.ts — CircuitOpen error class
 */

import { CircuitOpen, type ErrorCode, isOmniFocusError } from "../errors/index.js";
import { logger } from "../logging/logger.js";

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/**
 * Backpressure / fail-fast signals emitted by the middleware stack itself
 * (rate limiter, write-queue cap, a breaker that is already open). They mean
 * "slow down", not "this tool is broken" — counting them would convert a
 * brief burst of calls into a 60s OF_CIRCUIT_OPEN outage.
 */
const BACKPRESSURE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "OF_RATE_LIMITED",
  "OF_QUEUE_FULL",
  "OF_CIRCUIT_OPEN",
]);

/**
 * Predicate: should this thrown error count toward opening the per-tool
 * circuit?
 *
 * Mirrors the sibling transport circuit's discipline (`isCircuitTransient`
 * in `src/adapter/_shared/transportCircuit.ts`): only failures that suggest
 * the tool/OmniFocus pipeline is actually unhealthy may pollute the
 * consecutive-failure counter. Excluded by classification:
 *
 * - **input-class errors** (`remediationClass: "input"` — ValidationError,
 *   NotFound, ConflictError, LoopDetected): the caller's input is wrong;
 *   three stale-id probes must not lock a healthy tool for 60s.
 * - **backpressure signals** ({@link BACKPRESSURE_CODES}): the middleware's
 *   own throttling, thrown inside `breaker.call` by design (the breaker
 *   wraps the limiter so an open circuit doesn't burn rate slots).
 *
 * Unknown (non-taxonomy) errors still count — a repeatedly crashing handler
 * is a genuine outage signal.
 */
export function isCircuitCountableFailure(err: unknown): boolean {
  if (!isOmniFocusError(err)) return true;
  if (err.remediationClass === "input") return false;
  if (BACKPRESSURE_CODES.has(err.code)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The three states of the circuit breaker state machine. */
export type CircuitState = "closed" | "open" | "half_open";

/** Constructor options — all optional; defaults match DESIGN §6.10. */
export interface CircuitBreakerOptions {
  /** Number of consecutive failures that open the circuit. Default: 3. */
  failureThreshold?: number;
  /** Rolling window (ms) in which failures are counted. Default: 60 000. */
  windowMs?: number;
  /** Time (ms) the circuit stays open before moving to half-open. Default: 60 000. */
  openDurationMs?: number;
  /** Injected clock for testing. Defaults to `Date.now`. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

/**
 * Single-tool circuit breaker.
 *
 * Thread-safety note: Node.js is single-threaded; no locks are needed.
 * Concurrent async calls that both fail in the same tick both count toward
 * the failure threshold — this is the desired behaviour (fail fast).
 */
export class CircuitBreaker {
  private readonly _tool: string;
  private readonly _failureThreshold: number;
  private readonly _windowMs: number;
  private readonly _openDurationMs: number;
  private readonly _now: () => number;

  private _state: CircuitState = "closed";
  /** Timestamps (ms) of failures within the current window. */
  private _failures: number[] = [];
  /** Timestamp when the circuit opened; used to compute half-open transition. */
  private _openedAt: number | null = null;
  /** True when a half-open probe is already in flight. */
  private _probeInFlight = false;

  constructor(tool: string, options: CircuitBreakerOptions = {}) {
    this._tool = tool;
    this._failureThreshold = options.failureThreshold ?? 3;
    this._windowMs = options.windowMs ?? 60_000;
    this._openDurationMs = options.openDurationMs ?? 60_000;
    this._now = options.now ?? (() => Date.now());
  }

  /** Current state of the breaker. */
  get state(): CircuitState {
    this._maybeTransitionToHalfOpen();
    return this._state;
  }

  /**
   * Execute `fn` through the circuit breaker.
   *
   * - CLOSED: always calls `fn`; records success or failure.
   * - OPEN: throws `CircuitOpen` immediately without calling `fn`.
   * - HALF_OPEN: allows exactly one probe; if probe succeeds → CLOSED,
   *   if probe fails → OPEN again.
   *
   * @throws {CircuitOpen} when the circuit is open and no probe slot is available.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    this._maybeTransitionToHalfOpen();

    if (this._state === "open") {
      const retryAfterMs = this._retryAfterMs();
      throw new CircuitOpen(`Circuit for tool "${this._tool}" is open after repeated failures.`, {
        details: { tool: this._tool, retryAfterMs },
      });
    }

    if (this._state === "half_open") {
      if (this._probeInFlight) {
        // Only one probe at a time; other callers fast-fail.
        throw new CircuitOpen(
          `Circuit for tool "${this._tool}" is half-open; probe already in flight.`,
          { details: { tool: this._tool, retryAfterMs: 0 } },
        );
      }
      this._probeInFlight = true;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      // Input errors and backpressure signals are neither successes nor
      // outage evidence — they leave the breaker state untouched (a
      // half-open probe that hits one simply frees the probe slot for
      // the next caller).
      if (isCircuitCountableFailure(err)) {
        this._onFailure();
      }
      throw err;
    } finally {
      if (this._state === "half_open") {
        this._probeInFlight = false;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private — state transitions
  // ---------------------------------------------------------------------------

  /**
   * Check whether enough time has elapsed to move from OPEN → HALF_OPEN.
   * Called lazily before any state read or call.
   */
  private _maybeTransitionToHalfOpen(): void {
    if (this._state === "open" && this._openedAt !== null) {
      const elapsed = this._now() - this._openedAt;
      if (elapsed >= this._openDurationMs) {
        this._state = "half_open";
        this._probeInFlight = false;
        logger.info(
          { event: "circuit.half_open", tool: this._tool, elapsed },
          "circuit moved to half-open; probe allowed",
        );
      }
    }
  }

  private _onSuccess(): void {
    if (this._state === "half_open") {
      this._close("probe succeeded");
    } else {
      // Success resets the failure window in CLOSED state.
      this._failures = [];
    }
  }

  private _onFailure(): void {
    const now = this._now();

    if (this._state === "half_open") {
      // Probe failed — re-open immediately.
      this._open(now, "probe failed");
      return;
    }

    // Prune failures outside the rolling window.
    this._failures = this._failures.filter((t) => now - t < this._windowMs);
    this._failures.push(now);

    if (this._failures.length >= this._failureThreshold) {
      this._open(now, `${this._failures.length} failures within ${this._windowMs}ms`);
    }
  }

  private _open(now: number, reason: string): void {
    this._state = "open";
    this._openedAt = now;
    this._probeInFlight = false;
    logger.warn(
      {
        event: "circuit.opened",
        tool: this._tool,
        reason,
        openDurationMs: this._openDurationMs,
      },
      "circuit opened — fast-failing calls",
    );
  }

  private _close(reason: string): void {
    this._state = "closed";
    this._openedAt = null;
    this._failures = [];
    this._probeInFlight = false;
    logger.info(
      { event: "circuit.closed", tool: this._tool, reason },
      "circuit closed — resuming normal operation",
    );
  }

  /** Remaining ms before the open circuit will half-open. */
  private _retryAfterMs(): number {
    if (this._openedAt === null) return this._openDurationMs;
    const elapsed = this._now() - this._openedAt;
    return Math.max(0, this._openDurationMs - elapsed);
  }
}

// ---------------------------------------------------------------------------
// CircuitBreakerRegistry
// ---------------------------------------------------------------------------

/**
 * Registry that vends per-tool `CircuitBreaker` instances.
 *
 * Each tool name gets exactly one breaker (created lazily on first access).
 * Tool handlers call `registry.get(toolName).call(() => ...)`.
 */
export class CircuitBreakerRegistry {
  private readonly _breakers = new Map<string, CircuitBreaker>();
  private readonly _defaults: CircuitBreakerOptions;

  constructor(defaults: CircuitBreakerOptions = {}) {
    this._defaults = defaults;
  }

  /**
   * Return the breaker for `toolName`, creating one if it does not exist.
   */
  get(toolName: string): CircuitBreaker {
    let breaker = this._breakers.get(toolName);
    if (!breaker) {
      breaker = new CircuitBreaker(toolName, this._defaults);
      this._breakers.set(toolName, breaker);
    }
    return breaker;
  }

  /** Reset all breakers — useful in tests. */
  clear(): void {
    this._breakers.clear();
  }

  /** Number of registered breakers. */
  get size(): number {
    return this._breakers.size;
  }

  /**
   * Return a snapshot of all registered breakers' current states.
   * Safe to call at any time; does not mutate breaker state.
   */
  snapshot(): Array<{ name: string; state: CircuitState }> {
    return Array.from(this._breakers.entries()).map(([name, breaker]) => ({
      name,
      state: breaker.state,
    }));
  }
}

// ---------------------------------------------------------------------------
// Module singleton
// ---------------------------------------------------------------------------

/**
 * Module-level registry singleton.
 * Tool handlers import this and call `circuitBreakerRegistry.get(toolName)`.
 */
export const circuitBreakerRegistry = new CircuitBreakerRegistry();
