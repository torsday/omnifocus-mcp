/**
 * `withRateLimitMeta` — rate-limit middleware for MCP tool handlers.
 *
 * Wraps a tool handler to:
 * 1. Call `limiter.check(toolName)` — throws `RateLimited` if exceeded.
 * 2. On success: inject `meta.rateLimit = limiter.remaining(toolName)` into
 *    the returned envelope.
 * 3. On `RateLimited` error: pass through (the server's error handler will
 *    build the error envelope with `remaining: 0, resetAt`).
 *
 * The wrapper is transparent — it preserves the exact envelope shape and
 * type parameter of the wrapped handler. Cached responses (where the tool
 * handler returns without calling the limiter) should NOT use this wrapper;
 * calling it opts the response in to rate-limit tracking.
 *
 * @see src/rateLimit/ToolRateLimiter.ts
 * @see src/envelope/index.ts — ResponseMeta.rateLimit
 */

import type { ResponseMeta, ToolSuccess } from "../envelope/index.js";
import type { ToolRateLimiter } from "./ToolRateLimiter.js";

export function withRateLimitMeta<T>(
  toolName: string,
  limiter: ToolRateLimiter,
  handler: () => Promise<ToolSuccess<T>>,
): Promise<ToolSuccess<T>> {
  limiter.check(toolName); // throws RateLimited if exceeded
  return handler().then((envelope) => {
    const rl = limiter.remaining(toolName);
    return {
      ...envelope,
      meta: { ...envelope.meta, rateLimit: rl } satisfies ResponseMeta,
    };
  });
}
