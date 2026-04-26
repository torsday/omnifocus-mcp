/**
 * `withLoopDetection` — loop-detection middleware for MCP tool handlers.
 *
 * Wraps a tool handler to:
 * 1. Record the `(tool, args)` invocation via `LoopDetector.record()`.
 * 2. Emit a `loop.detected` warn log event on every detection (warn or error).
 * 3. If level is `"warn"` (calls ≥ `threshold`), append `WARN_LOOP_DETECTED`
 *    to `meta.warnings` of the response.
 * 4. If level is `"error"` (calls ≥ `errorThreshold`), throw `LoopDetected`
 *    (`OF_LOOP_DETECTED`) before invoking the handler — the agent is told to
 *    stop repeating and act on previous results.
 *
 * @see src/loopDetector/LoopDetector.ts
 * @see DESIGN.md §6.11 — loop detection
 * @see src/envelope/index.ts — ResponseMeta.warnings
 */

import type { ResponseMeta, ToolSuccess } from "../envelope/index.js";
import { LoopDetected } from "../errors/index.js";
import { logger } from "../logging/logger.js";
import type { LoopDetector } from "./LoopDetector.js";

/**
 * Wrap a tool handler with loop-detection.
 *
 * @param toolName - MCP tool name (e.g. `"task_list"`)
 * @param args - Raw input arguments passed to the tool (from the MCP request)
 * @param detector - Shared `LoopDetector` instance (typically a singleton)
 * @param handler - The actual tool handler to invoke
 */
export function withLoopDetection<T>(
  toolName: string,
  args: unknown,
  detector: LoopDetector,
  handler: () => Promise<ToolSuccess<T>>,
): Promise<ToolSuccess<T>> {
  const result = detector.record(toolName, args);

  if (result !== undefined) {
    const { level, warning } = result;
    const count = (warning.details?.count as number | undefined) ?? 0;
    const windowMs = ((warning.details?.windowSeconds as number | undefined) ?? 60) * 1000;

    logger.warn({
      event: "loop.detected",
      tool: toolName,
      callCount: count,
      windowMs,
      level,
    });

    if (level === "error") {
      return Promise.reject(
        new LoopDetected(toolName, count, (warning.details?.windowSeconds as number) ?? 60),
      );
    }
  }

  return handler().then((envelope) => {
    if (result === undefined) return envelope;

    const existingWarnings = envelope.meta.warnings ?? [];
    return {
      ...envelope,
      meta: {
        ...envelope.meta,
        warnings: [...existingWarnings, result.warning],
      } satisfies ResponseMeta,
    };
  });
}
