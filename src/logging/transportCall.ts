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

/**
 * Recursively serialize a value with object keys sorted at every depth so
 * structurally-identical inputs hash identically and structurally-distinct
 * inputs do not.
 *
 * The native `JSON.stringify(value, replacerArray)` form is *not*
 * sufficient: passing `Object.keys(value).sort()` as the replacer filters
 * properties to that fixed key list at *every* depth, so nested keys not
 * present at the top level get dropped — collapsing distinct calls into
 * the same hash.
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
