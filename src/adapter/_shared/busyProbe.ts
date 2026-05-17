/**
 * OmniFocus "busy" detection (#817).
 *
 * When a regular JXA / OmniJS call hits its 30s timeout, three causes are
 * possible:
 *
 *   1. **Wedged** — OmniFocus itself is in a bad state (corrupt sync, hung
 *      database, crash). Every subsequent call also times out. The
 *      transport circuit (#835) handles this case after 5 consecutive
 *      failures.
 *
 *   2. **Busy** — OmniFocus is up and answering AppleEvents, but the
 *      specific call was blocked. Almost always a UI-level modal (export
 *      sheet, sync-conflict dialog) or an in-flight sync holding the
 *      AppleScript queue.
 *
 *   3. **Cold start** — first call after OF launches; classifier #939
 *      handles this with the spawn-floor calibration.
 *
 * This module separates (2) from (1) by issuing a cheap responsiveness
 * probe after a Timeout fires. If the probe returns quickly, OmniFocus is
 * reachable — the originating call was Busy, not Wedged, and the agent
 * gets an actionable error message instead of "retry once".
 *
 * The probe runs ONLY on the error path; healthy calls are unaffected.
 *
 * @see #817 — this issue
 * @see #835 — transport circuit for the sustained-wedge case
 */

import type { ScriptSpawner, SpawnResult } from "../jxa/scriptRunner.js";

/** Default budget for the probe. Short enough not to materially slow error paths. */
export const DEFAULT_PROBE_TIMEOUT_MS = 500;

/**
 * The cheapest non-permission-triggering JXA call we can issue. Reading
 * `defaultDocument.name` requires no Automation permission against
 * OmniFocus (it's `application object > document > name` — a static
 * property), and the call returns whether or not a modal is open as
 * long as OF's AppleEvent queue is actually moving.
 */
export const RESPONSIVENESS_PROBE_SCRIPT = `
(function() {
  const of = Application("OmniFocus");
  return JSON.stringify({ name: of.defaultDocument.name() });
})()
`;

/**
 * Result of {@link probeOmniFocusResponsiveness}.
 *
 * - `"responsive"` — probe returned successfully → OF is up; original
 *   Timeout was a Busy condition (modal / sync), not a true wedge.
 * - `"unresponsive"` — probe timed out or otherwise failed → OF is
 *   wedged or not running. Caller should surface the original Timeout
 *   (the transport circuit picks it up on subsequent failures).
 */
export type ProbeOutcome = "responsive" | "unresponsive";

/**
 * Issue a fast responsiveness probe against OmniFocus.
 *
 * Uses the supplied JXA spawner so tests can fake it (production callers
 * pass `defaultJxaSpawner`). Returns `"responsive"` iff the probe exits
 * 0 with non-empty stdout within `timeoutMs`; any other result is
 * `"unresponsive"`.
 *
 * Never throws — observability code must never throw from an error path.
 */
export async function probeOmniFocusResponsiveness(
  spawner: ScriptSpawner,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<ProbeOutcome> {
  let result: SpawnResult;
  try {
    result = await spawner(RESPONSIVENESS_PROBE_SCRIPT, "{}", timeoutMs);
  } catch {
    return "unresponsive";
  }
  if (result.spawnError !== undefined) return "unresponsive";
  if (result.timedOut) return "unresponsive";
  if (result.exitCode !== 0) return "unresponsive";
  if (result.stdout.trim() === "") return "unresponsive";
  return "responsive";
}
