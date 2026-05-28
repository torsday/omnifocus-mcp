/**
 * `transport.call` event helper (#313).
 *
 * Emits one structured event per JXA / OmniJS script invocation at `debug`
 * level. Fired by `runJxaScript` and `runOmniJsScript` after the spawner
 * resolves (success or failure) so the duration captures the real spawn-and-
 * exec cost, not just the side of the call that succeeded.
 *
 * Event shape:
 *   {
 *     event: "transport.call",
 *     transport: "jxa" | "omnijs",
 *     scriptName: string | undefined,
 *     argsHash: string,        // sha1 prefix of stable JSON
 *     durationMs: number,      // total wall-clock (spawn + script)
 *     spawnFloorMs?: number,   // calibrated osascript spawn floor (#939)
 *     scriptMs?: number,       // max(0, durationMs - spawnFloorMs) (#939)
 *     outcome: "ok" | "error",
 *     correlationId?: string,  // from the surrounding withCorrelationId scope
 *   }
 *
 * `durationMs` is preserved for back-compat with existing consumers; the
 * `spawnFloorMs` / `scriptMs` split (#939) is additive and only present once
 * boot calibration has completed (omitted on the very first calls in a
 * process while calibration is still in flight).
 *
 * `argsHash` lets operators correlate identical calls without leaking the
 * args themselves — task names and notes stay out of the high-level log
 * channel per DESIGN §21 (PII redaction at info+).
 *
 * @see DESIGN.md §21 — observability contract (transport.call)
 * @see src/loopDetector/LoopDetector.ts — same hashing convention
 */

import { createHash } from "node:crypto";
import { stableStringify } from "../util/stableStringify.js";
import { getCorrelationId } from "./correlation.js";
import { logger } from "./logger.js";

/** Stable sha1-prefix hash of any JSON-serialisable args object. */
export function hashArgs(args: unknown): string {
  return createHash("sha1").update(stableStringify(args)).digest("hex").slice(0, 16);
}

/**
 * Strongly-typed event payload passed to {@link onTransportCall} subscribers.
 * Mirrors the structured log fields written by {@link emitTransportCall}
 * minus correlation/argsHash details that aren't relevant for in-process
 * observers (subscribers can compute or skip them as needed).
 */
export interface TransportCallEvent {
  transport: "jxa" | "omnijs";
  scriptName: string | undefined;
  durationMs: number;
  /** Calibrated osascript spawn floor — absent until #939 calibration completes. */
  spawnFloorMs?: number;
  /** `max(0, durationMs - spawnFloorMs)` when both are known; otherwise absent. */
  scriptMs?: number;
  outcome: "ok" | "error";
}

type TransportCallListener = (event: TransportCallEvent) => void;
const listeners: TransportCallListener[] = [];

/**
 * Subscribe to `transport.call` events. Returns a disposer that unsubscribes.
 *
 * In-process observers (response aggregators, latency aggregators, etc.)
 * register at composition time so the script runners stay free of any
 * observability dependency — the runners just call {@link emitTransportCall}
 * as before, and subscribers see the events without back-coupling.
 *
 * Listeners are invoked synchronously, in registration order, after the
 * structured log is written. A throwing listener does NOT abort the call
 * or prevent other listeners from running: emit is best-effort
 * instrumentation, never a failure point for the underlying transport.
 */
export function onTransportCall(listener: TransportCallListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/** Test helper — remove all registered listeners (call, retry, busy). Not used in production. */
export function __resetTransportCallListeners(): void {
  listeners.length = 0;
  retryListeners.length = 0;
  busyListeners.length = 0;
}

/** Emit a single `transport.call` event at debug level. */
export function emitTransportCall(
  transport: "jxa" | "omnijs",
  scriptName: string | undefined,
  args: unknown,
  durationMs: number,
  outcome: "ok" | "error",
  spawnFloorMs?: number,
): void {
  const split =
    spawnFloorMs !== undefined
      ? { spawnFloorMs, scriptMs: Math.max(0, durationMs - spawnFloorMs) }
      : {};
  logger.debug(
    {
      event: "transport.call",
      transport,
      scriptName,
      argsHash: hashArgs(args),
      durationMs,
      ...split,
      outcome,
      correlationId: getCorrelationId(),
    },
    "transport call",
  );

  if (listeners.length === 0) return;
  const event: TransportCallEvent = {
    transport,
    scriptName,
    durationMs,
    ...split,
    outcome,
  };
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {
      // Listener errors are swallowed — emit must never block a transport call.
    }
  }
}

// ---------------------------------------------------------------------------
// Retry / busy observer hooks (#823)
//
// `transport.retry` and `of.busy.detected` are already written as structured
// log lines by the script runners. These thin observer hooks let in-process
// subscribers (the telemetry sink) see the same events as discrete records
// without parsing the log stream — mirroring the `onTransportCall` pattern.
// The runners keep their existing `logger` calls; they additionally call
// `emitTransportRetry` / `emitTransportBusy` to notify subscribers. Notify is
// best-effort and never throws into the caller.
// ---------------------------------------------------------------------------

/** Payload for a retry-once event (#816), surfaced to observers (#823). */
export interface TransportRetryEvent {
  transport: "jxa" | "omnijs";
  scriptName: string | undefined;
  /** Why the first attempt was retryable (timeout / errno signature). */
  reason: string;
  /** Outcome of the retry attempt. */
  outcome: "ok" | "error";
  delayMs: number;
  /** Wall-clock of the retry attempt. */
  durationMs: number;
}

/** Payload for an OmniFocus-busy detection event (#835), surfaced to observers (#823). */
export interface TransportBusyEvent {
  transport: "jxa" | "omnijs";
  scriptName: string | undefined;
  timeoutMs: number;
}

type TransportRetryListener = (event: TransportRetryEvent) => void;
type TransportBusyListener = (event: TransportBusyEvent) => void;
const retryListeners: TransportRetryListener[] = [];
const busyListeners: TransportBusyListener[] = [];

/** Subscribe to `transport.retry` events. Returns a disposer. */
export function onTransportRetry(listener: TransportRetryListener): () => void {
  retryListeners.push(listener);
  return () => {
    const idx = retryListeners.indexOf(listener);
    if (idx >= 0) retryListeners.splice(idx, 1);
  };
}

/** Subscribe to `of.busy.detected` events. Returns a disposer. */
export function onTransportBusy(listener: TransportBusyListener): () => void {
  busyListeners.push(listener);
  return () => {
    const idx = busyListeners.indexOf(listener);
    if (idx >= 0) busyListeners.splice(idx, 1);
  };
}

/** Notify retry subscribers. Best-effort; the runner already logged the event. */
export function emitTransportRetry(event: TransportRetryEvent): void {
  for (const fn of retryListeners) {
    try {
      fn(event);
    } catch {
      // swallowed — instrumentation must never break the transport call
    }
  }
}

/** Notify busy subscribers. Best-effort; the runner already logged the event. */
export function emitTransportBusy(event: TransportBusyEvent): void {
  for (const fn of busyListeners) {
    try {
      fn(event);
    } catch {
      // swallowed — instrumentation must never break the transport call
    }
  }
}
