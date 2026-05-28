/**
 * Telemetry shape for the persistent JXA transport (#882).
 *
 * Lives in `observability/` — a utility layer reachable from every layer — so
 * the `internal_status` tool can type its probe without importing the adapter
 * implementation directly (the `no-layer-violation` custom lint forbids
 * `tools/` → `adapter/jxa/`). The counters themselves are produced by
 * `src/adapter/jxa/persistentScriptRunner.ts`.
 */
export interface PersistentTransportStats {
  /** Whether the persistent transport is the active JXA spawner this process. */
  enabled: boolean;
  /** Whether a child is currently alive. */
  alive: boolean;
  /** Total children spawned this process (includes the first and every restart). */
  spawns: number;
  /** Child exits this process did not initiate (crashes, OF killing osascript). */
  unexpectedExits: number;
  /** In-flight calls that were interrupted by a child exit and surfaced `restarted`. */
  restarts: number;
  /** Calls killed by the per-call timeout. */
  timeouts: number;
  /** Framed responses successfully returned. */
  callsServed: number;
}
