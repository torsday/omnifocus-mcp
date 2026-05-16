/**
 * Process-scoped osascript spawn-floor calibration (#939).
 *
 * The `transport.call` `durationMs` conflates two costs: the fixed
 * `osascript` fork + interpreter init + JXA bridge bring-up, and the script's
 * own JXA work. Splitting the two answers the question that gates the
 * persistent-REPL track (#882): "Does spawn cost dominate, or is the
 * bottleneck inside the script?"
 *
 * Strategy: run a single no-op script through the real spawner once per
 * process, treat the wall-clock as the spawn floor, cache for the process
 * lifetime, and expose the value so transport-call emitters can compute
 * `scriptMs = max(0, durationMs - spawnFloorMs)` on every call.
 *
 * The floor is a lower bound — real per-call spawn cost may be slightly
 * higher under cache pressure or system load — so `scriptMs` is a slight
 * over-estimate of script-only work. That's the safe direction (keeps us
 * conservative about claiming the REPL would help).
 *
 * Calibration is triggered lazily on first transport call (fire-and-forget);
 * a single in-flight promise dedupes concurrent triggers. Until calibration
 * completes, `getSpawnFloorMs()` returns `undefined` and emitters fall back
 * to the pre-#939 behavior (no split fields).
 *
 * @see src/logging/transportCall.ts — consumer of the floor value
 * @see src/adapter/jxa/scriptRunner.ts — JXA caller
 * @see src/adapter/omnijs/scriptRunner.ts — OmniJS caller
 */

import { logger } from "../../logging/logger.js";

/** A spawner that returns when the no-op script completes; structurally
 *  identical to the JXA/OmniJS `ScriptSpawner` types. */
type Spawner = (scriptBody: string, jsonArg: string, timeoutMs: number) => Promise<unknown>;

/** Minimal JXA no-op: defines `run(argv)` so the runner contract holds,
 *  and returns a valid JSON string so the spawner's success path fires. */
const CALIBRATION_SCRIPT = "function run(){return JSON.stringify({});}";

/** Calibration timeout. Generous; real spawn cost is sub-second on a healthy
 *  host, and on a wedged host we want the timeout to surface rather than the
 *  calibration to hang the rest of the loop. */
const CALIBRATION_TIMEOUT_MS = 5_000;

let cached: number | undefined;
let inflight: Promise<number> | undefined;

/**
 * Returns the cached spawn floor (ms), or `undefined` if calibration has not
 * yet completed. Cheap; no I/O.
 */
export function getSpawnFloorMs(): number | undefined {
  return cached;
}

/**
 * Trigger calibration if it hasn't run yet. Fire-and-forget at call sites —
 * callers should pass through whatever `getSpawnFloorMs()` returns now and
 * let later calls pick up the populated value.
 *
 * Idempotent: a second call while the first is in flight returns the same
 * promise; calls after the first resolves return immediately with the cached
 * value.
 */
export function ensureSpawnFloorCalibration(spawner: Spawner): Promise<number> {
  if (cached !== undefined) return Promise.resolve(cached);
  if (inflight !== undefined) return inflight;
  inflight = (async () => {
    const startedAt = performance.now();
    try {
      await spawner(CALIBRATION_SCRIPT, "{}", CALIBRATION_TIMEOUT_MS);
    } catch {
      // Calibration spawn failed — record the elapsed time anyway so we
      // don't retry on every call. A failing spawner means downstream
      // calls will fail too, surfacing the real problem.
    }
    const ms = Math.round(performance.now() - startedAt);
    cached = ms;
    logger.debug(
      { event: "observability.spawn.calibrated", spawnFloorMs: ms },
      "spawn floor calibrated",
    );
    return ms;
  })();
  return inflight;
}

/** Test-only: reset module state between cases. */
export function __resetSpawnFloorForTesting(): void {
  cached = undefined;
  inflight = undefined;
}
