/**
 * `DatabaseWatcher` — watches the OmniFocus database package for changes
 * and fires a debounced callback whenever OmniFocus writes to it.
 *
 * OmniFocus stores its database at:
 *   ~/Library/Application Support/OmniFocus/OmniFocus.ofocus
 *
 * That path is a directory package (SQLite files + metadata). Any OmniFocus
 * write touches the directory's mtime, which `fs.watch` detects. We debounce
 * at 500ms by default because OmniFocus makes several small writes per
 * logical change.
 *
 * The watcher is intentionally fault-tolerant:
 * - If the database path does not exist (first launch, permissions), `start()`
 *   logs a warn and returns without throwing.
 * - If `fs.watch` emits an error event, it is logged and the watcher is
 *   stopped gracefully (not crashed).
 *
 * Consumers call `start()` after connecting the MCP transport and `stop()`
 * during server shutdown.
 *
 * @see src/server/mcpServer.ts — integration point
 * @see DESIGN.md §6.11 — loop detection (related: database change awareness)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../logging/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DatabaseWatcherOptions {
  /**
   * Milliseconds to wait after the last fs.watch event before firing `onChange`.
   * Default: 500ms.
   */
  debounceMs?: number;
  /**
   * Override the database path. Default:
   * `~/Library/Application Support/OmniFocus/OmniFocus.ofocus`.
   * Primarily for testing.
   */
  dbPath?: string;
}

// ---------------------------------------------------------------------------
// Default path
// ---------------------------------------------------------------------------

export const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "OmniFocus",
  "OmniFocus.ofocus",
);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class DatabaseWatcher {
  private readonly dbPath: string;
  private readonly debounceMs: number;
  private readonly onChange: () => void;

  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  constructor(onChange: () => void, options: DatabaseWatcherOptions = {}) {
    this.onChange = onChange;
    this.debounceMs = options.debounceMs ?? 500;
    this.dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  }

  /**
   * Start watching. Safe to call multiple times — subsequent calls are no-ops.
   * Logs a warning and returns without throwing if the database path does not exist.
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

    try {
      this.watcher = fs.watch(this.dbPath, { persistent: false }, (_event, _filename) => {
        this.scheduleNotify();
      });

      this.watcher.on("error", (err) => {
        logger.warn({ event: "database.watcher.error", err });
        this.stop();
      });

      this.started = true;
      logger.debug({ event: "database.watcher.started", dbPath: this.dbPath });
    } catch (err) {
      logger.warn({ event: "database.watcher.start_failed", dbPath: this.dbPath, err });
    }
  }

  /**
   * Stop watching and clear any pending debounce timer.
   * Safe to call multiple times.
   */
  stop(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }
    this.started = false;
    logger.debug({ event: "database.watcher.stopped" });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private scheduleNotify(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      logger.debug({ event: "database.watcher.change_detected", dbPath: this.dbPath });
      this.onChange();
    }, this.debounceMs);
  }
}
