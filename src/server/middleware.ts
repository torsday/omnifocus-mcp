/**
 * Per-tool middleware composition for omnifocus-mcp (#291).
 *
 * Wraps every `server.registerTool` callback in the same uniform stack so
 * each tool handler — old and future — gets reliability and observability
 * primitives without per-tool wiring:
 *
 *     assertNotShuttingDown
 *       → withCircuitBreaker (per-tool registry)
 *         → withRateLimitMeta
 *           → withLoopDetection
 *             → handler
 *
 * **Why monkey-patch `registerTool`?** The alternative — threading a
 * `composeToolHandler` through ~30 register* helpers — adds a parameter to
 * every tool file for zero behavioural benefit. Patching once at server
 * construction guarantees the stack wraps every current and future
 * registration with no diff in the tool layer.
 *
 * **Order rationale.**
 *
 * 1. `assertNotShuttingDown` first: cheapest check, lets SIGINT win
 *    immediately without paying for breaker bookkeeping.
 * 2. `withCircuitBreaker` next: when a tool is consistently failing, we want
 *    fast-fail to short-circuit *before* burning rate-limit slots.
 * 3. `withRateLimitMeta` next: throws `RateLimited` before we touch the
 *    inner handler when the window is full; otherwise injects
 *    `meta.rateLimit` on success.
 * 4. `withLoopDetection` last: it never throws — only appends a warning to
 *    `meta.warnings` — so it sits closest to the handler where the meta it
 *    augments is freshest.
 *
 * **Envelope ↔ SDK shape.** The `registerTool` callback returns the SDK's
 * `{ content, structuredContent }` pair, while the middleware utilities
 * mutate the inner `ToolEnvelope` (under `structuredContent`). This patch
 * unwraps once before the middleware runs and re-packs once after, keeping
 * the inner middleware contract pure (`() => Promise<ToolSuccess<T>>`).
 *
 * @see DESIGN.md §6.10 — circuit breaker
 * @see DESIGN.md §6.11 — loop detection
 * @see DESIGN.md §16 — rate limiting
 * @see DESIGN.md §17 — graceful shutdown
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ToolEnvelope, type ToolSuccess, toolResponse } from "../envelope/index.js";
import type { LoopDetector } from "../loopDetector/LoopDetector.js";
import { withLoopDetection } from "../loopDetector/withLoopDetection.js";
import type { ToolRateLimiter } from "../rateLimit/ToolRateLimiter.js";
import { withRateLimitMeta } from "../rateLimit/withRateLimitMeta.js";
import type { CircuitBreakerRegistry } from "./circuitBreaker.js";
import type { ShutdownController } from "./shutdown.js";

/** Dependency bundle threaded into the patch. All required. */
export interface ToolMiddlewareDeps {
  rateLimiter: ToolRateLimiter;
  loopDetector: LoopDetector;
  circuitRegistry: CircuitBreakerRegistry;
  shutdown: ShutdownController;
}

/** Loose shape for the SDK tool callback — `(args, extra) => Promise<CallToolResult>`. */
type ToolCallback = (args: unknown, extra: unknown) => Promise<CallToolResult>;

/**
 * Wrap a single SDK tool callback in the full middleware stack.
 *
 * Exported for unit tests; production code should call
 * {@link installToolMiddleware} which patches `registerTool` once.
 */
export function composeToolCallback(
  toolName: string,
  callback: ToolCallback,
  deps: ToolMiddlewareDeps,
): ToolCallback {
  return async (args, extra) => {
    deps.shutdown.assertNotShuttingDown();

    const breaker = deps.circuitRegistry.get(toolName);

    return breaker.call(async () => {
      // Inner handler returns the envelope unwrapped from the SDK shape.
      // Casting to `ToolSuccess<unknown>` matches what every handler in this
      // codebase produces today — error envelopes are not returned (handlers
      // throw typed errors, which propagate to the SDK error path).
      const innerEnvelope = async (): Promise<ToolSuccess<unknown>> => {
        const result = await callback(args, extra);
        return result.structuredContent as unknown as ToolSuccess<unknown>;
      };

      const enveloped = await withRateLimitMeta(toolName, deps.rateLimiter, () =>
        withLoopDetection(toolName, args, deps.loopDetector, innerEnvelope),
      );

      return toolResponse(enveloped as ToolEnvelope<unknown>);
    });
  };
}

/**
 * Patch `server.registerTool` so every subsequent registration goes through
 * {@link composeToolCallback}. Idempotent — calling twice on the same server
 * is a no-op (subsequent calls would double-wrap, so we guard with a brand).
 *
 * Call this immediately after `createMcpServer()` and before any
 * `register*Tool` helper.
 */
export function installToolMiddleware(server: McpServer, deps: ToolMiddlewareDeps): void {
  type Branded = McpServer & { __omnifocusMiddlewareInstalled?: true };
  const branded = server as Branded;
  if (branded.__omnifocusMiddlewareInstalled === true) return;

  const original = server.registerTool.bind(server);

  // The SDK overload is fully generic; we preserve its surface but wrap the
  // callback. The function is invoked as `(name, config, cb)` for the only
  // overload our register* helpers use; widen to `unknown[]` so TS doesn't
  // collapse the parameter tuple to `never` under generic resolution.
  const patched = (...args: unknown[]): ReturnType<typeof original> => {
    const [name, config, cb] = args as [string, Parameters<typeof original>[1], ToolCallback];
    const wrapped = composeToolCallback(name, cb, deps);
    return (original as unknown as (...a: unknown[]) => ReturnType<typeof original>)(
      name,
      config,
      wrapped,
    );
  };

  (server as unknown as { registerTool: typeof patched }).registerTool = patched;
  branded.__omnifocusMiddlewareInstalled = true;
}
