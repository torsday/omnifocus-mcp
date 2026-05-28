/**
 * Unit tests for the persistent JXA transport (#882).
 *
 * Deterministic — never spawns `osascript`. A Node fake child
 * (`tests/lib/fakePersistentChild.ts`) speaks the same framing protocol and
 * exposes failure-mode triggers, so FIFO serialization, crash recovery,
 * per-call timeout, error passthrough, and telemetry are all exercised in CI
 * on any platform. The real runtime source is validated separately against
 * `osascript` in `persistentScriptRunner.integration.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { launchFakePersistentChild } from "../../../tests/lib/fakePersistentChild.js";
import { OmniFocusTransportRestarted } from "../../errors/index.js";
import { __resetTransportCircuitsForTest } from "../_shared/transportCircuit.js";
import { createPersistentJxaTransport } from "./persistentScriptRunner.js";
import { runJxaScript } from "./scriptRunner.js";

type Transport = ReturnType<typeof createPersistentJxaTransport>;

let transport: Transport | null = null;

function makeTransport(killGraceMs = 500): Transport {
  transport = createPersistentJxaTransport(launchFakePersistentChild, killGraceMs);
  return transport;
}

beforeEach(() => {
  __resetTransportCircuitsForTest();
});

afterEach(async () => {
  await transport?.dispose();
  transport = null;
});

describe("persistent JXA transport — happy path", () => {
  it("spawns one child lazily and echoes the argument back", async () => {
    const t = makeTransport();
    const before = t.stats();
    expect(before.alive).toBe(false);
    expect(before.spawns).toBe(0);

    const result = await t.spawner("echo", '{"hello":"world"}', 5000);
    expect(result).toMatchObject({ stdout: '{"hello":"world"}', exitCode: 0, timedOut: false });

    const after = t.stats();
    expect(after.alive).toBe(true);
    expect(after.spawns).toBe(1);
    expect(after.callsServed).toBe(1);
  });

  it("reuses the same child across calls (spawns once, not per call)", async () => {
    const t = makeTransport();
    for (let i = 0; i < 5; i++) await t.spawner("echo", `{"i":${i}}`, 5000);
    const stats = t.stats();
    expect(stats.spawns).toBe(1);
    expect(stats.callsServed).toBe(5);
  });

  it("serializes concurrent callers FIFO with no cross-talk", async () => {
    const t = makeTransport();
    const args = Array.from({ length: 8 }, (_, i) => `{"n":${i}}`);
    const results = await Promise.all(args.map((a) => t.spawner("echo", a, 5000)));
    // Each call gets its own argument back — single-in-flight, no interleave.
    expect(results.map((r) => r.stdout)).toEqual(args);
    expect(t.stats().spawns).toBe(1);
  });
});

describe("persistent JXA transport — crash recovery", () => {
  it("surfaces `restarted` when the child exits mid-call, then recovers next call", async () => {
    const t = makeTransport();
    await t.spawner("echo", "{}", 5000); // spawn #1

    const crashed = await t.spawner("__CRASH__", "{}", 5000);
    expect(crashed.restarted).toBe(true);
    expect(crashed.timedOut).toBe(false);

    // Next call transparently spawns a fresh child.
    const recovered = await t.spawner("echo", '{"ok":true}', 5000);
    expect(recovered).toMatchObject({ stdout: '{"ok":true}', exitCode: 0 });

    const stats = t.stats();
    expect(stats.spawns).toBe(2);
    expect(stats.restarts).toBe(1);
    expect(stats.unexpectedExits).toBe(1);
  });

  it("recovers from a hard SIGKILL mid-call", async () => {
    const t = makeTransport();
    await t.spawner("echo", "{}", 5000);
    const killed = await t.spawner("__KILL__", "{}", 5000);
    expect(killed.restarted).toBe(true);
    const recovered = await t.spawner("echo", '{"again":1}', 5000);
    expect(recovered.stdout).toBe('{"again":1}');
    expect(t.stats().restarts).toBe(1);
  });
});

describe("persistent JXA transport — timeout", () => {
  it("times out a wedged call, kills the child, and recovers on the next call", async () => {
    const t = makeTransport();
    const timedOut = await t.spawner("__HANG__", "{}", 120);
    expect(timedOut.timedOut).toBe(true);
    expect(timedOut.restarted).toBeUndefined();
    expect(t.stats().timeouts).toBe(1);

    const recovered = await t.spawner("echo", '{"post":"timeout"}', 5000);
    expect(recovered.stdout).toBe('{"post":"timeout"}');
    expect(t.stats().spawns).toBe(2);
  });
});

describe("persistent JXA transport — script-level error passthrough", () => {
  it("returns a non-zero exit with stderr (not a restart) for a script throw", async () => {
    const t = makeTransport();
    const result = await t.spawner("__ERR__", "Task not found: abc (-1728)", 5000);
    expect(result).toMatchObject({ exitCode: 1, timedOut: false });
    expect(result.restarted).toBeUndefined();
    expect(result.stderr).toContain("-1728");
  });
});

describe("persistent JXA transport — dispose", () => {
  it("closes the child and reports not-alive", async () => {
    const t = makeTransport();
    await t.spawner("echo", "{}", 5000);
    expect(t.stats().alive).toBe(true);
    await t.dispose();
    expect(t.stats().alive).toBe(false);
  });
});

describe("persistent JXA transport — runner integration", () => {
  it("maps a mid-call restart to OmniFocusTransportRestarted through runJxaScript", async () => {
    const t = makeTransport();
    await runJxaScript("echo", {}, { spawner: t.spawner }); // warm the child
    await expect(
      runJxaScript("__CRASH__", {}, { spawner: t.spawner, scriptName: "task_get" }),
    ).rejects.toBeInstanceOf(OmniFocusTransportRestarted);
  });
});
