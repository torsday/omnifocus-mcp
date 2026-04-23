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

export interface LoopDetectorConfig {
  /** Number of identical calls before the warning fires. Default 5. */
  threshold: number;
  /** Sliding window in seconds. Default 60. */
  windowSeconds: number;
}

const DEFAULT_CONFIG: LoopDetectorConfig = {
  threshold: 5,
  windowSeconds: 60,
};

/**
 * Build a stable dedup key from a tool name and its raw arguments object.
 *
 * Uses deterministic JSON serialization (keys sorted) so that
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` hash to the same value.
 */
export function buildCallKey(toolName: string, args: unknown): string {
  const serialized = JSON.stringify(args, Object.keys(args as object).sort());
  const hash = createHash("sha1").update(serialized).digest("hex").slice(0, 16);
  return `${toolName}:${hash}`;
}

export class LoopDetector {
  private readonly config: LoopDetectorConfig;
  /** Maps call key → sorted list of invocation timestamps (ms). */
  private readonly windows: Map<string, number[]> = new Map();

  constructor(config: Partial<LoopDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record an invocation and return a warning if the threshold is met.
   *
   * @param toolName - MCP tool name (e.g. `"task_list"`)
   * @param args - Raw input arguments passed to the tool
   * @returns A `WARN_LOOP_DETECTED` `Warning` when the threshold is reached,
   *          or `undefined` otherwise.
   */
  record(toolName: string, args: unknown): Warning | undefined {
    const key = buildCallKey(toolName, args);
    const now = Date.now();
    const cutoff = now - this.config.windowSeconds * 1000;

    const timestamps = this.getAndPrune(key, cutoff);
    timestamps.push(now);

    const count = timestamps.length;
    if (count >= this.config.threshold) {
      return {
        code: "WARN_LOOP_DETECTED",
        message: `Tool "${toolName}" has been called ${count} time(s) with identical arguments within ${this.config.windowSeconds}s.`,
        suggestion:
          "The agent may be stuck in a loop. Verify that the previous response was acted on before repeating this call.",
        details: { tool: toolName, count, windowSeconds: this.config.windowSeconds },
      };
    }

    return undefined;
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

  /** Get the timestamp array for a key, pruning stale entries in place. */
  private getAndPrune(key: string, cutoff: number): number[] {
    if (!this.windows.has(key)) {
      this.windows.set(key, []);
    }
    const timestamps = this.windows.get(key) as number[];

    // Prune oldest-first (timestamps are appended in order, so oldest is at [0])
    let i = 0;
    while (i < timestamps.length && (timestamps[i] as number) <= cutoff) {
      i++;
    }
    if (i > 0) timestamps.splice(0, i);

    return timestamps;
  }
}
