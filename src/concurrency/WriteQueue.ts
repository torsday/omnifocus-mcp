/**
 * `WriteQueue` — strictly serial, capped queue for OmniFocus writes.
 *
 * Per ADR-0009 / DESIGN §16, OmniFocus writes must be serialized (the JXA
 * runtime is single-threaded relative to OF's main thread) and bounded
 * (unbounded queueing masks upstream pressure). Each transport owns its own
 * `WriteQueue` — JXA writes are one queue, OmniJS is a separate one, because
 * the two channels contend on different kernel resources.
 *
 * Semantics:
 * - Single slot: at most one call runs at a time.
 * - Soft cap on pending (`OMNIFOCUS_WRITE_QUEUE_CAP`, default 50). Arrivals
 *   when `pendingCount() >= cap` reject synchronously with `QueueFull`.
 * - FIFO ordering among queued callers.
 * - A failing call does not block the queue: the next caller runs as soon
 *   as the failing promise settles.
 *
 * @see DESIGN.md §16 — concurrency model
 * @see ADR-0009 — read pool + write queue + OmniJS queue
 * @see src/errors/index.ts — QueueFull (`OF_QUEUE_FULL`)
 * @see src/server/shutdown.ts — DrainableQueue contract
 */

import { QueueFull } from "../errors/index.js";
import type { DrainableQueue } from "../server/shutdown.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WriteQueueOptions {
  /** Maximum number of pending calls (in-flight + queued). Must be positive. */
  cap: number;
  /** Human-readable name surfaced in shutdown logs, `QueueFull` messages, and `internal_status`. */
  name?: string;
}

type Job<T> = {
  fn: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

// ---------------------------------------------------------------------------
// WriteQueue
// ---------------------------------------------------------------------------

/**
 * Single-slot FIFO queue with soft-cap backpressure.
 */
export class WriteQueue implements DrainableQueue {
  readonly name: string;
  private readonly cap: number;
  private inFlight = 0;
  private readonly queue: Job<unknown>[] = [];

  constructor(options: WriteQueueOptions) {
    if (!Number.isInteger(options.cap) || options.cap < 1) {
      throw new RangeError(
        `WriteQueue.cap must be a positive integer (got ${String(options.cap)})`,
      );
    }
    this.cap = options.cap;
    this.name = options.name ?? "write-queue";
  }

  /**
   * Enqueue `fn`. Returns a promise that settles with its result. Throws
   * `QueueFull` synchronously when the queue is saturated — callers may
   * surface `error.details.retryAfterMs` to agents.
   */
  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.pendingCount() >= this.cap) {
      throw new QueueFull(
        `${this.name} is full (cap ${this.cap}); ${this.pendingCount()} pending`,
        { details: { queue: this.name, cap: this.cap, pending: this.pendingCount() } },
      );
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.pump();
    });
  }

  /** Calls currently executing. 0 or 1 for a single-slot queue. */
  inFlightCount(): number {
    return this.inFlight;
  }

  /** Calls queued but not yet started. */
  waitingCount(): number {
    return this.queue.length;
  }

  /** In-flight plus waiting — the total `DrainableQueue` depth. */
  pendingCount(): number {
    return this.inFlight + this.queue.length;
  }

  private pump(): void {
    if (this.inFlight > 0) return;
    const next = this.queue.shift();
    if (next === undefined) return;

    this.inFlight++;
    // Detach from the synchronous enqueue path so `run()` resolves/throws
    // only via the returned promise.
    void (async () => {
      try {
        const value = await next.fn();
        next.resolve(value);
      } catch (err) {
        next.reject(err);
      } finally {
        this.inFlight--;
        this.pump();
      }
    })();
  }
}
