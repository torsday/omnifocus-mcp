/**
 * `LoopDetector` — tracks recent (tool, args-hash) invocations to surface
 * agent loops early.
 *
 * Per DESIGN §6.11: if the same `(tool, serialized-args)` invocation occurs
 * ≥5 times within 60s, `record()` returns a `WARN_LOOP_DETECTED` warning so
 * the handler can include it in `meta.warnings`.
 *
 * The args hash is a simple stable-stringify checksum — not cryptographic,
 * just a compact dedup key. Different arg values → different key → no warning.
 *
 * Thread-safety: JavaScript is single-threaded; no locking needed.
 *
 * @see DESIGN.md §6.11 — loop detection
 */

import { createHash } from "node:crypto";
import type { Warning } from "../envelope/index.js";
import { stableStringify } from "../util/stableStringify.js";

/**
 * Result from `LoopDetector.record()`.
 *
 * - `"warn"` — call count just crossed `threshold`; append to `meta.warnings`.
 * - `"error"` — call count crossed `errorThreshold`; caller should throw.
 */
export type LoopDetectorResult =
  | { level: "warn"; warning: Warning }
  | { level: "error"; warning: Warning }
  | undefined;

export interface LoopDetectorConfig {
  /** Number of identical calls before the warning fires. Default 5. */
  threshold: number;
  /**
   * Number of identical calls before a hard `OF_LOOP_DETECTED` error is
   * thrown (via `withLoopDetection`). Must be ≥ `threshold`. Default 10.
   */
  errorThreshold: number;
  /** Sliding window in seconds. Default 60. */
  windowSeconds: number;
  /**
   * Hard cap on distinct (tool, args-hash) keys tracked simultaneously.
   * When exceeded, the oldest inserted key is evicted (FIFO). This bounds
   * memory for long-running servers that see many unique argument combinations.
   * Env: `OMNIFOCUS_LOOP_DETECTOR_MAX_KEYS`. Default: 4096.
   */
  maxKeys: number;
}

const DEFAULT_CONFIG: LoopDetectorConfig = {
  threshold: 5,
  errorThreshold: 10,
  windowSeconds: 60,
  maxKeys: 4096,
};

/**
 * Build a stable dedup key from a tool name and its raw arguments object.
 *
 * Uses deterministic recursive JSON serialization (keys sorted at every
 * level) so that `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` hash to the same
 * value, while `{ id: "X", changes: { name: "P1" } }` and
 * `{ id: "X", changes: { name: "P2" } }` do not.
 */
export function buildCallKey(toolName: string, args: unknown): string {
  const serialized = stableStringify(args);
  const hash = createHash("sha1").update(serialized).digest("hex").slice(0, 16);
  return `${toolName}:${hash}`;
}

export class LoopDetector {
  private readonly config: LoopDetectorConfig;
  /** Maps call key → sorted list of invocation timestamps (ms). Insertion-ordered for FIFO eviction. */
  private readonly windows: Map<string, number[]> = new Map();

  constructor(config: Partial<LoopDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Current number of distinct (tool, args-hash) keys tracked. */
  get size(): number {
    return this.windows.size;
  }

  /**
   * Record an invocation and return a result describing what action to take.
   *
   * - Returns `undefined` when below the warn threshold.
   * - Returns `{ level: "warn", warning }` when count is in `[threshold, errorThreshold)`.
   * - Returns `{ level: "error", warning }` when count reaches `errorThreshold`.
   *
   * @param toolName - MCP tool name (e.g. `"task_list"`)
   * @param args - Raw input arguments passed to the tool
   */
  record(toolName: string, args: unknown): LoopDetectorResult {
    const key = buildCallKey(toolName, args);
    const now = Date.now();
    const cutoff = now - this.config.windowSeconds * 1000;

    const timestamps = this.getAndPrune(key, cutoff);
    timestamps.push(now);

    const count = timestamps.length;
    if (count < this.config.threshold) return undefined;

    const warning: Warning = {
      code: "WARN_LOOP_DETECTED",
      message: `Tool "${toolName}" has been called ${count} time(s) with identical arguments within ${this.config.windowSeconds}s.`,
      suggestion:
        "The agent may be stuck in a loop. Verify that the previous response was acted on before repeating this call.",
      details: { tool: toolName, count, windowSeconds: this.config.windowSeconds },
    };

    if (count >= this.config.errorThreshold) {
      return { level: "error", warning };
    }
    return { level: "warn", warning };
  }

  /**
   * Reset the tracking state for a call key (useful in tests).
   * If `key` is omitted, clears all state.
   */
  reset(key?: string): void {
    if (key === undefined) {
      this.windows.clear();
    } else {
      this.windows.delete(key);
    }
  }

  /**
   * Get the timestamp array for a key, pruning stale entries in place.
   *
   * After pruning, if the array is empty and the key already existed, the key
   * is removed from the map so memory is reclaimed as windows expire.
   *
   * Before inserting a new key, enforces `maxKeys` by evicting the
   * oldest-inserted key (FIFO — Map preserves insertion order).
   */
  private getAndPrune(key: string, cutoff: number): number[] {
    const existing = this.windows.get(key);

    if (existing !== undefined) {
      // Prune oldest-first (timestamps are appended in order, so oldest is at [0])
      let i = 0;
      while (i < existing.length && (existing[i] as number) <= cutoff) {
        i++;
      }
      if (i > 0) existing.splice(0, i);

      // Evict keys whose window has fully expired to reclaim memory.
      if (existing.length === 0) {
        this.windows.delete(key);
        // Fall through to re-insert below — caller will push a new timestamp.
      } else {
        return existing;
      }
    }

    // New key (or re-inserted after full expiry): enforce maxKeys cap via FIFO eviction.
    if (this.windows.size >= this.config.maxKeys) {
      const oldest = this.windows.keys().next().value;
      if (oldest !== undefined) this.windows.delete(oldest);
    }

    const fresh: number[] = [];
    this.windows.set(key, fresh);
    return fresh;
  }
}
