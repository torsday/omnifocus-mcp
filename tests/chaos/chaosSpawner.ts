/**
 * Chaos harness — parameterised `ScriptSpawner` for DESIGN §19 failure modes.
 *
 * Each mode produces a `SpawnResult` that matches a real-world failure we
 * want transports to classify into the typed-error taxonomy (DESIGN §6.7):
 *
 *   - `of-not-running`      — OmniFocus quit; stderr matches the "Application
 *                             isn't running" signature → `OmniFocusNotRunning`.
 *   - `permission-denied`   — TCC denial (`-1743`) → `PermissionDenied`.
 *   - `timeout`             — the spawner reports `timedOut: true` → `Timeout`.
 *   - `malformed-json`      — exit 0 but stdout is not parseable → `ScriptError`.
 *   - `spawn-enoent`        — `osascript` missing → `TransportUnavailable`.
 *   - `empty-stdout`        — exit 0 with whitespace only → `ScriptError`.
 *   - `generic-script-error`— non-zero exit with an unclassified stderr → `ScriptError`.
 *
 * The harness never launches `osascript`; it only synthesises the `SpawnResult`
 * shape the script runners consume. Classification correctness lives in the
 * script runners; this file parameterises the symptoms for cross-transport
 * assertions.
 *
 * @see tests/chaos/transport.chaos.test.ts — consumer
 * @see src/adapter/jxa/scriptRunner.ts      — `classifyJxaStderr`
 * @see src/adapter/omnijs/scriptRunner.ts   — `classifyOmniJsStderr`
 */

import type { ScriptSpawner, SpawnResult } from "../../src/adapter/jxa/scriptRunner.js";

/**
 * Build a spawner that returns each supplied `SpawnResult` in order, one
 * per call, then repeats the last entry for any further calls. Models a
 * transient failure that recovers on retry — e.g. a cold-start timeout on
 * the first JXA call followed by a fast success (#887).
 *
 * @see tests/chaos/transport.chaos.test.ts — "slow first call recovers"
 */
export function sequencedSpawner(...results: SpawnResult[]): ScriptSpawner {
  if (results.length === 0) {
    throw new Error("sequencedSpawner requires at least one SpawnResult");
  }
  let call = 0;
  return async (): Promise<SpawnResult> => {
    const idx = Math.min(call, results.length - 1);
    call += 1;
    // biome-ignore lint/style/noNonNullAssertion: idx is clamped to a valid index.
    return results[idx]!;
  };
}

/** A `SpawnResult` representing a hard timeout (cold-start / contention). */
export const TIMEOUT_RESULT: SpawnResult = {
  stdout: "",
  stderr: "",
  exitCode: 1,
  timedOut: true,
};

/** Build a success `SpawnResult` carrying the given JSON stdout. */
export function okResult(stdout: string): SpawnResult {
  return { stdout, stderr: "", exitCode: 0, timedOut: false };
}

export type ChaosMode =
  | "of-not-running"
  | "permission-denied"
  | "timeout"
  | "malformed-json"
  | "spawn-enoent"
  | "empty-stdout"
  | "generic-script-error";

/** Build a `ScriptSpawner` that fails deterministically in the given mode. */
export function chaosSpawner(mode: ChaosMode): ScriptSpawner {
  return async (): Promise<SpawnResult> => {
    switch (mode) {
      case "of-not-running":
        return {
          stdout: "",
          stderr: "execution error: OmniFocus got an error: Application isn't running. (-600)",
          exitCode: 1,
          timedOut: false,
        };
      case "permission-denied":
        return {
          stdout: "",
          stderr: "execution error: Not authorized to send Apple events to OmniFocus. (-1743)",
          exitCode: 1,
          timedOut: false,
        };
      case "timeout":
        return {
          stdout: "",
          stderr: "",
          exitCode: 1,
          timedOut: true,
        };
      case "malformed-json":
        return {
          stdout: "not-json{{{",
          stderr: "",
          exitCode: 0,
          timedOut: false,
        };
      case "spawn-enoent": {
        const enoent = Object.assign(new Error("ENOENT: osascript not found"), {
          code: "ENOENT",
        }) as NodeJS.ErrnoException;
        return {
          stdout: "",
          stderr: "",
          exitCode: 1,
          timedOut: false,
          spawnError: enoent,
        };
      }
      case "empty-stdout":
        return {
          stdout: "   \n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
        };
      case "generic-script-error":
        return {
          stdout: "",
          stderr: "some unclassified failure from the OF script engine",
          exitCode: 2,
          timedOut: false,
        };
    }
  };
}
