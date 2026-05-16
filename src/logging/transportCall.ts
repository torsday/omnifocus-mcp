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
 *     durationMs: number,      // total wall-clock (spawn + script)
 *     spawnFloorMs?: number,   // calibrated osascript spawn floor (#939)
 *     scriptMs?: number,       // max(0, durationMs - spawnFloorMs) (#939)
 *     outcome: "ok" | "error",
 *     correlationId?: string,  // from the surrounding withCorrelationId scope
 *   }
 *
 * `durationMs` is preserved for back-compat with existing consumers; the
 * `spawnFloorMs` / `scriptMs` split (#939) is additive and only present once
 * boot calibration has completed (omitted on the very first calls in a
 * process while calibration is still in flight).
 *
 * `argsHash` lets operators correlate identical calls without leaking the
 * args themselves — task names and notes stay out of the high-level log
 * channel per DESIGN §21 (PII redaction at info+).
 *
 * @see DESIGN.md §21 — observability contract (transport.call)
 * @see src/loopDetector/LoopDetector.ts — same hashing convention
 */

import { createHash } from "node:crypto";
import { stableStringify } from "../util/stableStringify.js";
import { getCorrelationId } from "./correlation.js";
import { logger } from "./logger.js";

/** Stable sha1-prefix hash of any JSON-serialisable args object. */
export function hashArgs(args: unknown): string {
  return createHash("sha1").update(stableStringify(args)).digest("hex").slice(0, 16);
}

/** Emit a single `transport.call` event at debug level. */
export function emitTransportCall(
  transport: "jxa" | "omnijs",
  scriptName: string | undefined,
  args: unknown,
  durationMs: number,
  outcome: "ok" | "error",
  spawnFloorMs?: number,
): void {
  const split =
    spawnFloorMs !== undefined
      ? { spawnFloorMs, scriptMs: Math.max(0, durationMs - spawnFloorMs) }
      : {};
  logger.debug(
    {
      event: "transport.call",
      transport,
      scriptName,
      argsHash: hashArgs(args),
      durationMs,
      ...split,
      outcome,
      correlationId: getCorrelationId(),
    },
    "transport call",
  );
}
