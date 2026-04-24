/**
 * `transport.call` event helper (#313).
 *
 * Emits one structured event per JXA / OmniJS script invocation at `debug`
 * level. Fired by `runJxaScript` and `runOmniJsScript` after the spawner
 * resolves (success or failure) so the duration captures the real spawn-and-
 * exec cost, not just the side of the call that succeeded.
 *
 * Event shape:
 *   {
 *     event: "transport.call",
 *     transport: "jxa" | "omnijs",
 *     scriptName: string | undefined,
 *     argsHash: string,        // sha1 prefix of stable JSON
 *     durationMs: number,
 *     outcome: "ok" | "error",
 *     correlationId?: string,  // from the surrounding withCorrelationId scope
 *   }
 *
 * `argsHash` lets operators correlate identical calls without leaking the
 * args themselves — task names and notes stay out of the high-level log
 * channel per DESIGN §21 (PII redaction at info+).
 *
 * @see DESIGN.md §21 — observability contract (transport.call)
 * @see src/loopDetector/LoopDetector.ts — same hashing convention
 */

import { createHash } from "node:crypto";
import { getCorrelationId } from "./correlation.js";
import { logger } from "./logger.js";

/** Stable sha1-prefix hash of any JSON-serialisable args object. */
export function hashArgs(args: unknown): string {
  // Sort top-level keys when args is a plain object so `{a:1,b:2}` and
  // `{b:2,a:1}` collapse to the same hash. Non-objects (primitives, arrays,
  // null) serialize as-is.
  const isPlainObject = typeof args === "object" && args !== null && !Array.isArray(args);
  const serialized = isPlainObject
    ? JSON.stringify(args, Object.keys(args as object).sort())
    : JSON.stringify(args ?? null);
  return createHash("sha1").update(serialized).digest("hex").slice(0, 16);
}

/** Emit a single `transport.call` event at debug level. */
export function emitTransportCall(
  transport: "jxa" | "omnijs",
  scriptName: string | undefined,
  args: unknown,
  durationMs: number,
  outcome: "ok" | "error",
): void {
  logger.debug(
    {
      event: "transport.call",
      transport,
      scriptName,
      argsHash: hashArgs(args),
      durationMs,
      outcome,
      correlationId: getCorrelationId(),
    },
    "transport call",
  );
}
