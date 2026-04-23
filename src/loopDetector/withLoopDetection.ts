/**
 * `withLoopDetection` — loop-detection middleware for MCP tool handlers.
 *
 * Wraps a tool handler to:
 * 1. Record the `(tool, args)` invocation via `LoopDetector.record()`.
 * 2. If a `WARN_LOOP_DETECTED` warning is returned, append it to the
 *    `meta.warnings` array of the response.
 *
 * The wrapper is transparent — it preserves the envelope shape and type
 * parameter of the wrapped handler. It never blocks or throws on loop
 * detection; the warning is advisory only.
 *
 * @see src/loopDetector/LoopDetector.ts
 * @see DESIGN.md §6.11 — loop detection
 * @see src/envelope/index.ts — ResponseMeta.warnings
 */

import type { ResponseMeta, ToolSuccess } from "../envelope/index.js";
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
  const warning = detector.record(toolName, args);

  return handler().then((envelope) => {
    if (warning === undefined) return envelope;

    const existingWarnings = envelope.meta.warnings ?? [];
    return {
      ...envelope,
      meta: {
        ...envelope.meta,
        warnings: [...existingWarnings, warning],
      } satisfies ResponseMeta,
    };
  });
}
