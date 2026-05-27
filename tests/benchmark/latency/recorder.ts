/**
 * Recorder — collects `transport.call` events emitted by the script
 * runners (#941).
 *
 * Subscribes via {@link onTransportCall} (the same observer hook used by
 * the latency-stats aggregator in production) so we capture every osascript
 * spawn and OmniJS invocation without modifying the spawners themselves.
 * The recorder is workflow-scoped: instantiate one per worker process,
 * `start()` before the workflow runs, `stop()` after, and read `events`.
 */

import { onTransportCall, type TransportCallEvent } from "../../../src/logging/transportCall.js";
import type { ScriptCallEvent } from "./types.js";

export class Recorder {
  private readonly _events: ScriptCallEvent[] = [];
  private dispose: (() => void) | undefined;
  private nextSeq = 0;

  /** Begin recording. Idempotent — calling twice is a no-op. */
  start(): void {
    if (this.dispose !== undefined) return;
    this.dispose = onTransportCall((event: TransportCallEvent) => {
      const e: ScriptCallEvent = {
        transport: event.transport,
        scriptName: event.scriptName,
        durationMs: event.durationMs,
        outcome: event.outcome,
        sequence: this.nextSeq,
        ...(event.spawnFloorMs !== undefined ? { spawnFloorMs: event.spawnFloorMs } : {}),
      };
      this._events.push(e);
      this.nextSeq += 1;
    });
  }

  /** Stop recording. Idempotent. */
  stop(): void {
    if (this.dispose === undefined) return;
    this.dispose();
    this.dispose = undefined;
  }

  /** Snapshot the events recorded so far. The returned array is a copy. */
  get events(): ScriptCallEvent[] {
    return [...this._events];
  }

  /** Drop all recorded events without unsubscribing. Test helper. */
  reset(): void {
    this._events.length = 0;
    this.nextSeq = 0;
  }
}
