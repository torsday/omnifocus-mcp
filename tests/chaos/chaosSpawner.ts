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
