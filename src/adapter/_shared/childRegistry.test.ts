/**
 * Tests for the osascript child-process registry (#839).
 *
 * These spawn REAL child processes (short-lived `node` invocations) so the
 * SIGTERM → SIGKILL escalation is exercised against actual OS process
 * semantics, not a mock. This is the "send SIGTERM during a long-running call;
 * confirm clean shutdown, no orphan processes" smoke test from the issue AC,
 * minus the live-OmniFocus dependency — a long-lived `node` child stands in for
 * an in-flight `osascript` call.
 *
 * @see src/adapter/_shared/childRegistry.ts
 */

import { type ChildProcess, spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetChildRegistryForTest,
  activeChildCount,
  killActiveChildren,
  trackChild,
} from "./childRegistry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Spawn a long-lived child that keeps the event loop alive until killed. */
function spawnLongLived(): ChildProcess {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
}

/**
 * Spawn a child that traps SIGTERM and refuses to exit, so only SIGKILL can
 * stop it. Exercises the force-kill escalation path. The child writes `ready`
 * to stdout *after* the handler is registered so the test can avoid the race
 * where SIGTERM lands during node's startup (before the handler exists, where
 * the default terminate behaviour would apply).
 */
function spawnSigtermIgnoring(): ChildProcess {
  return spawn(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)",
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
}

/** Resolve once the child has written its first byte of stdout. */
function waitForReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.stdout?.once("data", () => resolve());
  });
}

/** Resolve once the child has fully exited (so the OS has reaped it). */
function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });
}

afterEach(() => {
  __resetChildRegistryForTest();
});

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

describe("childRegistry — tracking", () => {
  it("starts empty", () => {
    expect(activeChildCount()).toBe(0);
  });

  it("tracks a spawned child and prunes it on natural exit", async () => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    trackChild(child);
    expect(activeChildCount()).toBe(1);

    await waitForExit(child);
    // The `exit` listener prunes synchronously; give the microtask a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(activeChildCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// killActiveChildren
// ---------------------------------------------------------------------------

describe("childRegistry — killActiveChildren", () => {
  it("is a no-op when nothing is in flight", async () => {
    expect(await killActiveChildren(50)).toBe(0);
  });

  it("SIGTERMs an in-flight child and drains the registry", async () => {
    const child = spawnLongLived();
    trackChild(child);
    expect(activeChildCount()).toBe(1);

    const killed = await killActiveChildren(2_000);
    expect(killed).toBe(1);

    await waitForExit(child);
    expect(activeChildCount()).toBe(0);
    // Killed by signal, not a self-chosen exit code.
    expect(child.signalCode).not.toBeNull();
  });

  it("escalates to SIGKILL for a child that ignores SIGTERM", async () => {
    const child = spawnSigtermIgnoring();
    trackChild(child);
    await waitForReady(child); // ensure the SIGTERM handler is registered first

    // Short grace so the SIGTERM window lapses quickly and SIGKILL fires.
    const killed = await killActiveChildren(100);
    expect(killed).toBe(1);

    await waitForExit(child);
    expect(child.signalCode).toBe("SIGKILL");
    expect(activeChildCount()).toBe(0);
  });

  it("terminates multiple in-flight children in one sweep", async () => {
    const children = [spawnLongLived(), spawnLongLived(), spawnLongLived()];
    for (const c of children) trackChild(c);
    expect(activeChildCount()).toBe(3);

    expect(await killActiveChildren(2_000)).toBe(3);
    await Promise.all(children.map(waitForExit));
    expect(activeChildCount()).toBe(0);
  });
});
