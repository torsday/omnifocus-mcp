/**
 * `withInvocationLogging` — per-tool invocation event middleware (#283).
 *
 * Wraps an MCP tool handler so every call emits exactly one log event:
 *
 *   - `tool.invoked` on success — `{ tool, durationMs, transport, cacheHit, correlationId }`
 *   - `tool.error` on a thrown error — `{ tool, durationMs, code?, correlationId, err }`
 *
 * Sits at the bottom of the middleware stack so `durationMs` measures the
 * handler's actual wall-clock cost (excluding rate-limit / circuit-breaker
 * bookkeeping, which already have their own dedicated events). The
 * correlationId is read from the surrounding `withCorrelationId` scope so it
 * matches the value that ends up in `ResponseMeta.correlationId`.
 *
 * Failure handling: typed `OmniFocusError`s log `tool.error` with their stable
 * `code` and re-throw so the SDK builds the error envelope. Untyped throws
 * still emit `tool.error` (with `code: "UNKNOWN"`) and re-throw — they will
 * surface to the unhandled-exception path.
 *
 * @see DESIGN.md §21 — observability contract
 * @see SPEC.md NFR — Observability
 */

import type { ToolSuccess } from "../envelope/index.js";
import { isOmniFocusError } from "../errors/index.js";
import { getCorrelationId } from "./correlation.js";
import { logger } from "./logger.js";

/**
 * Wrap a tool handler with invocation logging. The wrapper is transparent —
 * it returns the handler's envelope unchanged.
 *
 * @param toolName - MCP tool name (e.g. `"task_list"`)
 * @param handler - Inner envelope-returning handler to invoke
 */
export async function withInvocationLogging<T>(
  toolName: string,
  handler: () => Promise<ToolSuccess<T>>,
): Promise<ToolSuccess<T>> {
  const startedAt = performance.now();
  try {
    const envelope = await handler();
    const durationMs = Math.round(performance.now() - startedAt);
    logger.info(
      {
        event: "tool.invoked",
        tool: toolName,
        correlationId: getCorrelationId(),
        durationMs,
        transport: envelope.meta.transport,
        cacheHit: envelope.meta.cacheHit,
      },
      "tool invoked",
    );
    return envelope;
  } catch (err) {
    const durationMs = Math.round(performance.now() - startedAt);
    const code = isOmniFocusError(err) ? err.code : "UNKNOWN";
    logger.warn(
      {
        event: "tool.error",
        tool: toolName,
        correlationId: getCorrelationId(),
        durationMs,
        code,
        err,
      },
      "tool error",
    );
    throw err;
  }
}
