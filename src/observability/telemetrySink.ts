/**
 * `TelemetrySink` — opt-in append-only JSONL export of observability events
 * for offline trend analysis (#823).
 *
 * In-process observability (response stats, transport-call log, retry/busy
 * events, cache invalidations) lives only in memory and is lost on restart.
 * For "is my JXA latency creeping up over weeks?" questions an operator needs
 * a durable export. This sink writes one JSON object per line to an
 * operator-chosen path; downstream log shipping / analysis is the operator's
 * concern.
 *
 * Design (per #823):
 * - **Opt-in:** a sink is only constructed when `OMNIFOCUS_TELEMETRY_SINK_PATH`
 *   is set. When unset, {@link buildTelemetrySink} returns `undefined` and
 *   composition wires no subscribers — zero overhead, zero behavior change.
 * - **Non-blocking:** `record()` appends to an in-memory buffer and returns
 *   immediately; a timer flushes the buffer to disk asynchronously. Disk
 *   latency never blocks a transport call.
 * - **Size-bounded:** before each flush, if the file would exceed
 *   `maxBytes`, it is rotated to a single `<path>.1` backup (the previous
 *   backup is overwritten) and a fresh file is started. One backup only —
 *   this is a rolling operator log, not an archive.
 * - **Operator owns the path:** the sink never creates directories. A bad
 *   path disables the sink (logged once) rather than crashing the server —
 *   telemetry export must never take down the process.
 * - **ADR-0006:** no shared persistence; this is operator-side log shipping
 *   of already-PII-redacted events (redaction happens at the source, #9).
 *
 * @see docs/observability/telemetry-sink.md
 * @see #823
 */

import { appendFileSync, renameSync, statSync } from "node:fs";
import { logger } from "../logging/logger.js";

/** A single telemetry record. `event` is the discriminator; the rest is event-specific. */
export interface TelemetryEvent {
  /** Event kind — `transport.call`, `transport.retry`, `of.busy.detected`, `cache.invalidated`, `response.stats.sample`. */
  event: string;
  [key: string]: unknown;
}

export interface TelemetrySinkOptions {
  /** Absolute or relative path the operator chose. Parent dir must already exist. */
  path: string;
  /** Rotate when the file would exceed this many bytes. */
  maxBytes: number;
  /** Flush cadence in ms. Lower = more durable, more IO. Default 1000. */
  flushIntervalMs?: number;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Buffered, size-rotating JSONL writer. Construct via {@link buildTelemetrySink}
 * in production (it reads config and returns `undefined` when disabled).
 */
export class TelemetrySink {
  private readonly path: string;
  private readonly maxBytes: number;
  private readonly flushIntervalMs: number;
  private readonly now: () => number;

  private buffer: string[] = [];
  private bufferedBytes = 0;
  private currentFileBytes = 0;
  private timer: NodeJS.Timeout | undefined;
  private disabled = false;

  constructor(options: TelemetrySinkOptions) {
    this.path = options.path;
    this.maxBytes = options.maxBytes;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.now = options.now ?? Date.now;
    // Seed the running size from any existing file so rotation accounts for
    // prior runs appending to the same path.
    try {
      this.currentFileBytes = statSync(this.path).size;
    } catch {
      this.currentFileBytes = 0; // file doesn't exist yet — fine
    }
  }

  /**
   * Queue an event for the next flush. The `ts` field is stamped here (sink
   * clock) so every line is timestamped even when the event payload isn't.
   * Never throws — instrumentation must not break callers.
   */
  record(event: TelemetryEvent): void {
    if (this.disabled) return;
    let line: string;
    try {
      line = `${JSON.stringify({ ts: new Date(this.now()).toISOString(), ...event })}\n`;
    } catch {
      return; // non-serialisable payload — drop it rather than throw
    }
    this.buffer.push(line);
    this.bufferedBytes += Buffer.byteLength(line, "utf8");
  }

  /** Start the periodic background flush. Idempotent. */
  start(): void {
    if (this.timer !== undefined || this.disabled) return;
    this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
    // Don't keep the event loop alive solely for telemetry flushing.
    this.timer.unref?.();
  }

  /**
   * Write all buffered lines to disk now, rotating first if the file would
   * exceed `maxBytes`. Synchronous append (`appendFileSync`) — the call runs
   * off the hot path (background timer / shutdown), and the in-memory buffer
   * is what keeps `record()` non-blocking. Disables the sink on unrecoverable
   * IO errors so a bad path never repeatedly throws.
   */
  flush(): void {
    if (this.disabled || this.buffer.length === 0) return;
    const pending = this.buffer;
    const pendingBytes = this.bufferedBytes;
    this.buffer = [];
    this.bufferedBytes = 0;

    try {
      if (this.currentFileBytes + pendingBytes > this.maxBytes && this.currentFileBytes > 0) {
        this.rotate();
      }
      appendFileSync(this.path, pending.join(""), "utf8");
      this.currentFileBytes += pendingBytes;
    } catch (err) {
      this.disable(err);
    }
  }

  /** Flush remaining events. Call on clean shutdown. */
  close(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.flush();
  }

  /** True once an IO error has permanently disabled the sink (test/inspection aid). */
  get isDisabled(): boolean {
    return this.disabled;
  }

  /** Rename the current file to `<path>.1` (overwriting any prior backup) and start fresh. */
  private rotate(): void {
    renameSync(this.path, `${this.path}.1`);
    this.currentFileBytes = 0;
  }

  private disable(err: unknown): void {
    if (this.disabled) return;
    this.disabled = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.buffer = [];
    this.bufferedBytes = 0;
    logger.warn(
      { event: "telemetry.sink.disabled", path: this.path, reason: String(err) },
      "telemetry sink disabled after IO error — export stopped for this process",
    );
  }
}

/**
 * Build a sink from config, or `undefined` when telemetry export is disabled
 * (`path` empty/unset). Composition wires subscribers only when this returns
 * a sink, so the disabled path has zero cost.
 */
export function buildTelemetrySink(config: {
  path: string;
  maxBytes: number;
}): TelemetrySink | undefined {
  if (config.path.trim() === "") return undefined;
  const sink = new TelemetrySink({ path: config.path, maxBytes: config.maxBytes });
  sink.start();
  return sink;
}
