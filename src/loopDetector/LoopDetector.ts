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
}

const DEFAULT_CONFIG: LoopDetectorConfig = {
  threshold: 5,
  errorThreshold: 10,
  windowSeconds: 60,
};

/**
 * Recursively serialize a value so structurally-identical inputs produce
 * identical strings: object keys are sorted at every nesting level, arrays
 * preserve order, primitives go through `JSON.stringify`. `undefined` is
 * encoded explicitly so it survives the hash (plain `JSON.stringify`
 * returns `undefined`).
 *
 * The native `JSON.stringify(value, replacerArray)` form is *not*
 * sufficient: passing `Object.keys(value).sort()` as the replacer filters
 * properties to that fixed key list at *every* depth, so nested keys not
 * present at the top level get dropped. That made
 * `{id:"X", changes:{name:"P1"}}` and `{id:"X", changes:{name:"P2"}}`
 * collide, producing false-positive `WARN_LOOP_DETECTED` (and after the
 * error threshold, hard `OF_LOOP_DETECTED` errors that blocked legitimate
 * follow-up calls).
 */
function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

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
  /** Maps call key → sorted list of invocation timestamps (ms). */
  private readonly windows: Map<string, number[]> = new Map();

  constructor(config: Partial<LoopDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
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
