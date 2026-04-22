/**
 * Graceful shutdown controller for omnifocus-mcp.
 *
 * Implements the DESIGN §17 shutdown sequence:
 *   1. Set `isShuttingDown = true` — tool handlers call `assertNotShuttingDown()`
 *      at entry and receive `ServerShuttingDown` for new calls.
 *   2. Drain in-flight reads (READ_GRACE_MS, default 5 s).
 *   3. Drain in-flight writes (WRITE_GRACE_MS, default 10 s).
 *   4. Flush the pino logger.
 *   5. Emit `server.shutdown` log event and exit 0.
 *
 * In-flight tracking is pluggable: M1 transport layers register a
 * `DrainableQueue` via `registerQueue()`. Until then, drain resolves
 * immediately because there are no queued calls.
 *
 * Usage:
 *   import { shutdownController } from './shutdown.js';
 *   shutdownController.assertNotShuttingDown();  // in every tool handler
 *   shutdownController.registerQueue(readPool);  // in JxaTransport
 *
 * @see DESIGN.md §17 — lifecycle and shutdown sequence
 */

import { ServerShuttingDown } from "../errors/index.js";
import { logger } from "../logging/logger.js";

// ---------------------------------------------------------------------------
// Grace-period defaults
// ---------------------------------------------------------------------------

/** Default ms to wait for in-flight reads to finish. */
export const DEFAULT_READ_GRACE_MS = 5_000;

/** Default ms to wait for in-flight writes to finish. */
export const DEFAULT_WRITE_GRACE_MS = 10_000;

/** Poll interval when checking whether queues have drained. */
const DRAIN_POLL_MS = 50;

// ---------------------------------------------------------------------------
// DrainableQueue interface — implemented by M1 transport queues
// ---------------------------------------------------------------------------

/**
 * A named in-flight counter that the shutdown controller drains before exit.
 * M1 transport classes implement this interface and register with
 * `shutdownController.registerQueue()`.
 */
export interface DrainableQueue {
  /** Human-readable name used in shutdown log events. */
  readonly name: string;
  /** Number of requests currently in flight. */
  pendingCount(): number;
}

// ---------------------------------------------------------------------------
// ShutdownController
// ---------------------------------------------------------------------------

/** Constructor options for ShutdownController. */
export interface ShutdownControllerOptions {
  /** Override the read-drain grace window (ms). Defaults to env var or 5 s. */
  readGraceMs?: number;
  /** Override the write-drain grace window (ms). Defaults to env var or 10 s. */
  writeGraceMs?: number;
}

/**
 * Controls the server's shutdown lifecycle.
 *
 * Exposes:
 * - `isShuttingDown` — read by the MCP bootstrap; checked by tool handlers
 * - `assertNotShuttingDown()` — throws `ServerShuttingDown` when set
 * - `registerQueue(q)` — registers a drainable transport queue
 * - `initiate(reason)` — starts the full drain + exit sequence
 */
export class ShutdownController {
  private _shuttingDown = false;
  private readonly _queues: DrainableQueue[] = [];
  private readonly _readGraceMs: number;
  private readonly _writeGraceMs: number;

  constructor(options: ShutdownControllerOptions = {}) {
    this._readGraceMs =
      options.readGraceMs ?? Number(process.env.OMNIFOCUS_READ_GRACE_MS ?? DEFAULT_READ_GRACE_MS);
    this._writeGraceMs =
      options.writeGraceMs ??
      Number(process.env.OMNIFOCUS_WRITE_GRACE_MS ?? DEFAULT_WRITE_GRACE_MS);
  }

  /** True once `initiate()` has been called. Monotonically false→true. */
  get isShuttingDown(): boolean {
    return this._shuttingDown;
  }

  /**
   * Throw `ServerShuttingDown` if shutdown has started.
   * Call this at the entry of every tool handler.
   */
  assertNotShuttingDown(): void {
    if (this._shuttingDown) {
      throw new ServerShuttingDown();
    }
  }

  /**
   * Register a drainable queue so the shutdown sequence waits for it.
   * Idempotent — registering the same object twice is a no-op.
   */
  registerQueue(queue: DrainableQueue): void {
    if (!this._queues.includes(queue)) {
      this._queues.push(queue);
    }
  }

  /**
   * Begin the graceful shutdown sequence. Idempotent — subsequent calls
   * return immediately without re-running the sequence.
   *
   * Sequence:
   *   1. Set `isShuttingDown = true`
   *   2. Drain all registered queues within their grace window
   *   3. Flush pino logger
   *   4. `process.exit(0)`
   *
   * @param reason  Human-readable trigger source (e.g. "SIGINT", "SIGTERM").
   * @param exitFn  Injectable exit function; defaults to `process.exit`. Use
   *                in tests to avoid actually exiting the test process.
   */
  async initiate(reason: string, exitFn: (code: number) => void = process.exit): Promise<void> {
    if (this._shuttingDown) return;
    this._shuttingDown = true;

    logger.info(
      {
        event: "server.shutdown",
        reason,
        readGraceMs: this._readGraceMs,
        writeGraceMs: this._writeGraceMs,
      },
      "graceful shutdown initiated",
    );

    // Drain all queues within a combined grace window.
    // In M0 there are no queues; this resolves immediately.
    const totalGraceMs = this._readGraceMs + this._writeGraceMs;
    await this._drainAll(totalGraceMs);

    // Flush the pino logger — pino uses a synchronous write to stderr, so
    // `flush()` ensures the last log line is written before exit.
    logger.flush();

    exitFn(0);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Poll until all registered queues report zero pending calls, or until
   * `timeoutMs` elapses. Logs a warning for any queue that did not drain.
   */
  private async _drainAll(timeoutMs: number): Promise<void> {
    if (this._queues.length === 0) return;

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const pending = this._queues.filter((q) => q.pendingCount() > 0);
      if (pending.length === 0) return;

      await new Promise<void>((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
    }

    // Timeout — log which queues are still active and proceed to exit anyway.
    const stillPending = this._queues.filter((q) => q.pendingCount() > 0);
    for (const q of stillPending) {
      logger.warn(
        { event: "server.shutdown.drain_timeout", queue: q.name, pending: q.pendingCount() },
        "queue did not drain within grace window; forcing shutdown",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Module singleton
// ---------------------------------------------------------------------------

/**
 * Module-level singleton shutdown controller.
 * Import and use this in `mcpServer.ts` and all tool handlers.
 */
export const shutdownController = new ShutdownController();
