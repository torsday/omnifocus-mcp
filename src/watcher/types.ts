/**
 * Shared types for the DatabaseWatcher subsystem.
 *
 * These are kept in their own file so mcpServer.ts, DatabaseWatcher.ts, and
 * the adapter layer can all reference them without circular imports.
 */

// ---------------------------------------------------------------------------
// ChangeContext — passed to the onChange callback
// ---------------------------------------------------------------------------

/**
 * Context delivered to the `onChange` callback every time a debounced change
 * fires. Richer context is available when the Swift FSEventStream watcher is
 * active; the Node `fs.watch` fallback provides only the timestamp.
 */
export interface ChangeContext {
  /**
   * ISO-8601 timestamp of the *first* filesystem event in this debounce
   * window. Use as the lower bound for a "modified since" JXA query —
   * subtract a small safety buffer (e.g. 200 ms) to guard against clock skew
   * between the Swift process and the JXA runtime.
   */
  detectedAt: string;

  /**
   * Source of the change detection.
   * - `"swift"` — native FSEventStream via the compiled binary (preferred)
   * - `"node"`  — Node.js `fs.watch` fallback
   */
  source: "swift" | "node";

  /**
   * Relative file paths within the `.ofocus` package that changed.
   * Only present when `source === "swift"`.
   *
   * These are paths relative to the watched root (e.g. `"abc123.ofobjz"`).
   * The consuming layer should not attempt to parse object IDs from these
   * filenames directly — OmniFocus's internal format is not public. Use
   * `adapter.getChangesSince(detectedAt)` to resolve semantic object IDs.
   */
  changedPaths?: string[];
}

// ---------------------------------------------------------------------------
// WatchEvent — JSON lines emitted by the Swift binary
// ---------------------------------------------------------------------------

/**
 * Shape of each line emitted to stdout by the `omnifocus-watcher` binary.
 * Validated at runtime before constructing a ChangeContext.
 */
export interface WatchEvent {
  event: "change";
  /** Relative paths within the .ofocus package */
  paths: string[];
  /** ISO-8601 timestamp from the Swift process */
  ts: string;
}
