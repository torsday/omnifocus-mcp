/**
 * `ReadPool` — bounded-concurrency semaphore for OmniFocus reads.
 *
 * Per ADR-0009 / DESIGN §16, reads are gated at `OMNIFOCUS_READ_POOL_SIZE`
 * (default 2) so we don't stampede `osascript`. Writes use `WriteQueue`;
 * OmniJS traffic uses a separate `WriteQueue` instance because URL-scheme
 * callbacks contend on the filesystem.
 *
 * Semantics:
 * - `run(fn)` acquires a slot, runs `fn`, releases the slot.
 * - Callers that arrive when all slots are busy queue FIFO.
 * - A slot is always released, even if `fn` throws.
 * - `pendingCount()` returns in-flight + waiting, enabling the shutdown
 *   controller and `internal_status` to drain deterministically.
 *
 * @see DESIGN.md §16 — concurrency model
 * @see ADR-0009 — read pool + write queue + OmniJS queue
 * @see src/server/shutdown.ts — DrainableQueue contract
 */

import type { DrainableQueue } from "../server/shutdown.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Waiter = () => void;

export interface ReadPoolOptions {
  /** Maximum concurrent runs. Must be a positive integer. */
  size: number;
  /** Human-readable name surfaced in shutdown logs and status. */
  name?: string;
}

// ---------------------------------------------------------------------------
// ReadPool
// ---------------------------------------------------------------------------

/**
 * FIFO-fair bounded-concurrency pool. Creates no slot objects — just a
 * counter + waiter queue.
 */
export class ReadPool implements DrainableQueue {
  readonly name: string;
  private readonly size: number;
  private inFlight = 0;
  private readonly waiters: Waiter[] = [];

  constructor(options: ReadPoolOptions) {
    if (!Number.isInteger(options.size) || options.size < 1) {
      throw new RangeError(
        `ReadPool.size must be a positive integer (got ${String(options.size)})`,
      );
    }
    this.size = options.size;
    this.name = options.name ?? "read-pool";
  }

  /**
   * Run `fn` as soon as a slot is free. Preserves FIFO among waiters.
   * Always releases the slot, even when `fn` rejects.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Slots currently occupied by in-flight work. */
  inFlightCount(): number {
    return this.inFlight;
  }

  /** Callers waiting for a free slot. */
  waitingCount(): number {
    return this.waiters.length;
  }

  /** In-flight plus waiting — the total `DrainableQueue` depth. */
  pendingCount(): number {
    return this.inFlight + this.waiters.length;
  }

  private acquire(): Promise<void> {
    if (this.inFlight < this.size) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.inFlight++;
        resolve();
      });
    });
  }

  private release(): void {
    this.inFlight--;
    const next = this.waiters.shift();
    if (next !== undefined) next();
  }
}
