/**
 * `ToolRateLimiter` — per-tool sliding-window rate limiter.
 *
 * Each tool name gets its own window. When `check(toolName)` is called:
 * 1. Prune timestamps outside the sliding window.
 * 2. If count >= limit: throw `RateLimited` with `retryAfterMs` = time
 *    until the oldest call in the window expires.
 * 3. Otherwise: record the call timestamp and return void.
 *
 * Thread-safety: JavaScript is single-threaded; no locking needed.
 *
 * @see DESIGN.md §16 — rate limiting
 * @see src/errors/index.ts — RateLimited error
 * @see src/config/env.ts — OMNIFOCUS_TOOL_RATE_LIMIT config
 */

import { RateLimited } from "../errors/index.js";

export interface RateLimitConfig {
  /** Maximum number of calls allowed per window. */
  limit: number;
  /** Sliding window size in seconds. */
  windowSeconds: number;
}

export class ToolRateLimiter {
  private readonly config: RateLimitConfig;
  private readonly windows: Map<string, number[]> = new Map();

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Check and record a call for the given tool.
   * @throws {RateLimited} when the call would exceed the configured limit.
   */
  check(toolName: string): void {
    const now = Date.now();
    const cutoff = now - this.config.windowSeconds * 1000;
    const timestamps = this.getAndPrune(toolName, cutoff);

    if (timestamps.length >= this.config.limit) {
      const windowStart = timestamps[0] as number;
      const retryAfterMs = windowStart + this.config.windowSeconds * 1000 - now + 1;
      throw new RateLimited(
        `Rate limit exceeded for tool "${toolName}". Limit: ${this.config.limit} calls per ${this.config.windowSeconds}s.`,
        { details: { retryAfterMs } },
      );
    }

    timestamps.push(now);
  }

  /**
   * Return the current window state for a tool (for use in meta.rateLimit).
   * Does NOT record a call — read-only.
   */
  remaining(toolName: string): { remaining: number; resetAt: string } {
    const now = Date.now();
    const cutoff = now - this.config.windowSeconds * 1000;
    const timestamps = this.getAndPrune(toolName, cutoff);

    const remaining = this.config.limit - timestamps.length;
    const resetAt =
      timestamps.length > 0
        ? new Date((timestamps[0] as number) + this.config.windowSeconds * 1000).toISOString()
        : new Date(now + this.config.windowSeconds * 1000).toISOString();

    return { remaining, resetAt };
  }

  /** Clear all call records for a tool (used in tests). */
  reset(toolName: string): void {
    this.windows.delete(toolName);
  }

  /** Get the timestamp array for a tool, pruning stale entries in place. */
  private getAndPrune(toolName: string, cutoff: number): number[] {
    if (!this.windows.has(toolName)) {
      this.windows.set(toolName, []);
    }
    const timestamps = this.windows.get(toolName) as number[];

    // Prune timestamps outside the window (array is maintained in insertion order, oldest first)
    let i = 0;
    while (i < timestamps.length && (timestamps[i] as number) <= cutoff) {
      i++;
    }
    if (i > 0) {
      timestamps.splice(0, i);
    }

    return timestamps;
  }
}
