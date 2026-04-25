/**
 * `DatabaseWatcher` — watches the OmniFocus database package for changes
 * and fires a debounced `ChangeContext` callback with rich metadata.
 *
 * ## Fast path — Swift FSEventStream watcher (preferred)
 *
 * When the compiled `omnifocus-watcher` binary is present (see
 * `scripts/build-watcher.sh`), `DatabaseWatcher` spawns it as a child
 * process. The binary uses macOS FSEventStream at the OS kernel level —
 * file-granularity events, sub-millisecond latency, zero Node overhead.
 * The binary streams JSON lines to stdout:
 *
 *   {"event":"change","paths":["abc.ofobjz"],"ts":"2026-04-25T17:00:00.123Z"}
 *
 * Node collects these lines, debounces the burst, and calls `onChange` with
 * `source: "swift"` and the earliest `detectedAt` in the window.
 *
 * ## Slow path — Node.js `fs.watch` fallback
 *
 * If the binary is absent or fails to start, `DatabaseWatcher` falls back to
 * `fs.watch` on the `.ofocus` directory. Change detection is coarser (no
 * per-file paths) but functionally correct. `onChange` is called with
 * `source: "node"`.
 *
 * ## Graceful degradation
 *
 * - If the database path does not exist, `start()` logs a warning and returns
 *   without throwing. Neither path is started.
 * - If the Swift binary exits unexpectedly, the watcher falls back to Node
 *   `fs.watch` automatically without surfacing an error to the caller.
 * - `stop()` is idempotent; safe to call multiple times.
 *
 * @see tools/watcher/omnifocus-watcher.swift — Swift FSEventStream source
 * @see scripts/build-watcher.sh — build script
 * @see src/watcher/types.ts — ChangeContext, WatchEvent
 * @see src/server/mcpServer.ts — integration point
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { logger } from "../logging/logger.js";
import type { ChangeContext, WatchEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DatabaseWatcherOptions {
  /**
   * Milliseconds to wait after the last event before firing `onChange`.
   * Default: 500ms.
   */
  debounceMs?: number;
  /**
   * Override the database path. Default:
   * `~/Library/Application Support/OmniFocus/OmniFocus.ofocus`.
   * Primarily for testing.
   */
  dbPath?: string;
  /**
   * Override the path to the `omnifocus-watcher` Swift binary.
   * Default: `<package-root>/bin/omnifocus-watcher`.
   * Set to `null` to force the Node `fs.watch` fallback in tests.
   */
  binaryPath?: string | null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "OmniFocus",
  "OmniFocus.ofocus",
);

/**
 * Resolve the default binary path relative to this file's location so it
 * works identically in `src/` (tsx dev) and `dist/` (compiled) layouts:
 *   src/watcher/DatabaseWatcher.ts  →  ../../bin/omnifocus-watcher
 *   dist/watcher/DatabaseWatcher.js →  ../../bin/omnifocus-watcher
 */
function defaultBinaryPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(thisFile), "../../bin/omnifocus-watcher");
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class DatabaseWatcher {
  private readonly dbPath: string;
  private readonly debounceMs: number;
  private readonly onChange: (ctx: ChangeContext) => void;
  private readonly binaryPath: string | null;

  // State
  private started = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Earliest detectedAt in the current debounce window */
  private windowStartTs: string | null = null;
  /** All paths collected in the current debounce window (Swift path only) */
  private windowPaths: string[] = [];

  // Resource handles — at most one of these is live at a time
  private swiftProcess: ChildProcess | null = null;
  private nodeWatcher: fs.FSWatcher | null = null;

  constructor(onChange: (ctx: ChangeContext) => void, options: DatabaseWatcherOptions = {}) {
    this.onChange = onChange;
    this.debounceMs = options.debounceMs ?? 500;
    this.dbPath = options.dbPath ?? DEFAULT_DB_PATH;
    this.binaryPath = options.binaryPath !== undefined ? options.binaryPath : defaultBinaryPath();
  }

  /**
   * Start watching. Safe to call multiple times — subsequent calls are no-ops.
   * Prefers the Swift binary; falls back to Node fs.watch if unavailable.
   */
  start(): void {
    if (this.started) return;

    if (!fs.existsSync(this.dbPath)) {
      logger.warn({
        event: "database.watcher.path_not_found",
        dbPath: this.dbPath,
        message: "OmniFocus database path not found; change notifications will not fire.",
      });
      return;
    }

    const launched = this.tryStartSwift();
    if (!launched) {
      this.startNodeWatcher();
    }

    this.started = true;
  }

  /**
   * Stop watching and clear any pending debounce timer.
   * Safe to call multiple times.
   */
  stop(): void {
    this.clearDebounce();

    if (this.swiftProcess !== null) {
      // SIGTERM → Swift handler flushes stdout then exits 0
      this.swiftProcess.kill("SIGTERM");
      this.swiftProcess = null;
    }

    if (this.nodeWatcher !== null) {
      this.nodeWatcher.close();
      this.nodeWatcher = null;
    }

    this.started = false;
    logger.debug({ event: "database.watcher.stopped" });
  }

  // ---------------------------------------------------------------------------
  // Swift fast path
  // ---------------------------------------------------------------------------

  private tryStartSwift(): boolean {
    if (this.binaryPath === null) return false;

    // Check binary exists and is executable before spawning
    try {
      fs.accessSync(this.binaryPath, fs.constants.X_OK);
    } catch {
      logger.debug({
        event: "database.watcher.swift_unavailable",
        binaryPath: this.binaryPath,
        message: "Swift watcher binary not found or not executable; falling back to fs.watch.",
      });
      return false;
    }

    try {
      this.swiftProcess = spawn(this.binaryPath, [this.dbPath], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Drain stderr to logger (diagnostic messages from the Swift binary)
      this.swiftProcess.stderr?.on("data", (chunk: Buffer) => {
        logger.debug({ event: "database.watcher.swift_stderr", msg: chunk.toString().trim() });
      });

      // Parse JSON lines from stdout
      const rl = createInterface({ input: this.swiftProcess.stdout! });
      rl.on("line", (line) => {
        this.handleSwiftLine(line);
      });

      // If the process dies unexpectedly, fall back to Node watcher
      this.swiftProcess.on("exit", (code, signal) => {
        if (this.started) {
          logger.warn({
            event: "database.watcher.swift_exited",
            code,
            signal,
            message: "Swift watcher exited unexpectedly; falling back to fs.watch.",
          });
          this.swiftProcess = null;
          this.startNodeWatcher();
        }
      });

      this.swiftProcess.on("error", (err) => {
        logger.warn({ event: "database.watcher.swift_error", err });
        this.swiftProcess = null;
        this.startNodeWatcher();
      });

      logger.debug({ event: "database.watcher.swift_started", dbPath: this.dbPath });
      return true;
    } catch (err) {
      logger.warn({ event: "database.watcher.swift_spawn_failed", err });
      return false;
    }
  }

  private handleSwiftLine(line: string): void {
    if (!line.trim()) return;
    try {
      const evt = JSON.parse(line) as WatchEvent;
      if (evt.event !== "change") return;
      this.scheduleNotify({ source: "swift", ts: evt.ts, paths: evt.paths });
    } catch (err) {
      logger.debug({ event: "database.watcher.swift_parse_error", line, err });
    }
  }

  // ---------------------------------------------------------------------------
  // Node.js fs.watch fallback
  // ---------------------------------------------------------------------------

  private startNodeWatcher(): void {
    if (!fs.existsSync(this.dbPath)) return;

    try {
      this.nodeWatcher = fs.watch(this.dbPath, { persistent: false }, (_event, _filename) => {
        this.scheduleNotify({ source: "node", ts: new Date().toISOString() });
      });

      this.nodeWatcher.on("error", (err) => {
        logger.warn({ event: "database.watcher.node_error", err });
        this.stop();
      });

      logger.debug({ event: "database.watcher.node_started", dbPath: this.dbPath });
    } catch (err) {
      logger.warn({ event: "database.watcher.node_start_failed", dbPath: this.dbPath, err });
    }
  }

  // ---------------------------------------------------------------------------
  // Debounce
  // ---------------------------------------------------------------------------

  private scheduleNotify(event: { source: "swift" | "node"; ts: string; paths?: string[] }): void {
    // Record the earliest timestamp seen in this debounce window
    if (this.windowStartTs === null) {
      this.windowStartTs = event.ts;
    }
    // Accumulate paths (Swift path only)
    if (event.paths) {
      for (const p of event.paths) {
        if (!this.windowPaths.includes(p)) this.windowPaths.push(p);
      }
    }

    // Reset the trailing-edge timer
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const ctx: ChangeContext = {
        detectedAt: this.windowStartTs ?? new Date().toISOString(),
        source: event.source,
        ...(this.windowPaths.length > 0 ? { changedPaths: [...this.windowPaths] } : {}),
      };
      this.windowStartTs = null;
      this.windowPaths = [];

      logger.debug({
        event: "database.watcher.change_detected",
        source: ctx.source,
        detectedAt: ctx.detectedAt,
        pathCount: ctx.changedPaths?.length ?? 0,
      });
      this.onChange(ctx);
    }, this.debounceMs);
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.windowStartTs = null;
    this.windowPaths = [];
  }
}
