/**
 * Registry of live `osascript` child processes, for graceful shutdown (#839).
 *
 * Both the JXA and OmniJS script runners spawn `osascript` via
 * `child_process.execFile`. Each spawned child holds the OmniFocus database
 * open while it runs. If the server exits (SIGINT/SIGTERM) while a child is
 * mid-flight, that child is orphaned — it keeps running detached and keeps
 * OmniFocus locked, so the *next* server start can't acquire the database and
 * read/write scripts fail until the orphan finally times out.
 *
 * This module tracks every spawned child and exposes {@link killActiveChildren}
 * so the shutdown controller can terminate survivors after the in-flight drain
 * window closes: SIGTERM first, then SIGKILL for any child that ignores it.
 *
 * The registry is a process-global singleton (children are a process-global
 * resource). It self-prunes: each tracked child is removed on `exit` / `error`,
 * so a clean run leaves the set empty and {@link killActiveChildren} is a no-op.
 *
 * @see src/server/shutdown.ts — registers {@link killActiveChildren} as a cleanup
 * @see ADR-0009 — concurrency pool and queue (what feeds these spawns)
 */

import type { ChildProcess } from "node:child_process";
import { logger } from "../../logging/logger.js";

/** Default grace window (ms) between SIGTERM and the SIGKILL escalation. */
export const DEFAULT_CHILD_KILL_GRACE_MS = 2_000;

/** Poll interval (ms) while waiting for SIGTERM'd children to exit. */
const KILL_POLL_MS = 25;

/** Live children, keyed by identity. Self-pruned on `exit` / `error`. */
const activeChildren = new Set<ChildProcess>();

/**
 * Register a freshly spawned child so the shutdown controller can terminate it
 * if the process exits before the child finishes. Idempotent per child. The
 * child is removed automatically when it emits `exit` or `error`, so callers
 * never need to untrack manually.
 */
export function trackChild(child: ChildProcess): void {
  activeChildren.add(child);
  const prune = (): void => {
    activeChildren.delete(child);
  };
  child.once("exit", prune);
  child.once("error", prune);
}

/** Number of `osascript` children currently in flight. */
export function activeChildCount(): number {
  return activeChildren.size;
}

/**
 * Terminate all tracked children. Sends SIGTERM to each, waits up to `graceMs`
 * for them to exit on their own, then SIGKILLs any survivor. Returns the number
 * of children that were signalled (0 when the registry is already empty, the
 * normal case after a clean drain).
 *
 * Safe to call when nothing is in flight — it returns immediately. `kill()` on
 * an already-exited child is a harmless no-op and any throw is swallowed so one
 * dead child can't abort the sweep.
 *
 * @param graceMs  ms to wait after SIGTERM before escalating to SIGKILL.
 */
export async function killActiveChildren(
  graceMs: number = DEFAULT_CHILD_KILL_GRACE_MS,
): Promise<number> {
  const signalled = [...activeChildren];
  if (signalled.length === 0) return 0;

  logger.info(
    { event: "server.shutdown.kill_children", count: signalled.length, graceMs },
    "terminating in-flight osascript children",
  );

  for (const child of signalled) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Already exited between snapshot and kill — harmless.
    }
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && activeChildren.size > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, KILL_POLL_MS));
  }

  const survivors = [...activeChildren];
  for (const child of survivors) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Race: exited just now. Harmless.
    }
  }
  if (survivors.length > 0) {
    logger.warn(
      { event: "server.shutdown.kill_children_force", count: survivors.length },
      "force-killed osascript children that ignored SIGTERM",
    );
  }

  return signalled.length;
}

/**
 * Test-only: clear the registry without signalling. Use in `afterEach` so a
 * child left tracked by one test can't leak into the next. Mirrors the
 * `__reset*ForTest` convention used elsewhere in the adapter layer.
 */
export function __resetChildRegistryForTest(): void {
  activeChildren.clear();
}
