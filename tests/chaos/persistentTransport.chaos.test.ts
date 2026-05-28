/**
 * Persistent-transport chaos tests (#882).
 *
 * Exercises the long-lived JXA child's failure recovery through the fake
 * persistent child (`tests/lib/fakePersistentChild.ts`) so the assertions are
 * deterministic and run in CI on any platform — no `osascript`. The real
 * osascript runtime and its memory ceiling are validated in
 * `src/adapter/jxa/persistentScriptRunner.integration.test.ts`.
 *
 * @see src/adapter/jxa/persistentScriptRunner.ts — the transport under test
 * @see tests/lib/fakePersistentChild.ts          — the framing-protocol fake
 */

import { afterEach, describe, expect, it } from "vitest";
import { createPersistentJxaTransport } from "../../src/adapter/jxa/persistentScriptRunner.js";
import { launchFakePersistentChild } from "../lib/fakePersistentChild.js";

type Transport = ReturnType<typeof createPersistentJxaTransport>;
let transport: Transport | null = null;

afterEach(async () => {
  await transport?.dispose();
  transport = null;
});

describe("persistent transport — crash mid-call recovers within one call", () => {
  it("a SIGKILL'd child is transparently replaced on the next call", async () => {
    transport = createPersistentJxaTransport(launchFakePersistentChild, 500);

    // Warm the child, then crash it hard mid-call.
    const ok1 = await transport.spawner("echo", '{"phase":"before"}', 5000);
    expect(ok1.stdout).toBe('{"phase":"before"}');
    const spawnsBeforeCrash = transport.stats().spawns;

    const killed = await transport.spawner("__KILL__", "{}", 5000);
    expect(killed.restarted).toBe(true);

    // Recovery happens in exactly one call — the next request succeeds against a
    // fresh child, spawned on demand.
    const ok2 = await transport.spawner("echo", '{"phase":"after"}', 5000);
    expect(ok2.stdout).toBe('{"phase":"after"}');
    expect(transport.stats().spawns).toBe(spawnsBeforeCrash + 1);
  });
});

describe("persistent transport — repeated crashes do not wedge the FIFO", () => {
  it("recovers from a burst of consecutive crashes and still serves work", async () => {
    transport = createPersistentJxaTransport(launchFakePersistentChild, 500);

    const CRASHES = 10;
    for (let i = 0; i < CRASHES; i++) {
      const crashed = await transport.spawner("__CRASH__", "{}", 5000);
      expect(crashed.restarted).toBe(true);
      // Interleave a good call so each crash is followed by a clean recovery.
      const recovered = await transport.spawner("echo", `{"i":${i}}`, 5000);
      expect(recovered.stdout).toBe(`{"i":${i}}`);
    }

    const stats = transport.stats();
    expect(stats.restarts).toBe(CRASHES);
    expect(stats.unexpectedExits).toBe(CRASHES);
    // Lazy respawn means one spawn per crash recovery plus the initial — never a
    // busy respawn loop.
    expect(stats.alive).toBe(true);
    expect(stats.callsServed).toBe(CRASHES); // only the echoes return frames
  });
});

describe("persistent transport — interleaved timeouts and crashes", () => {
  it("stays serving after a timeout followed by a crash", async () => {
    transport = createPersistentJxaTransport(launchFakePersistentChild, 500);

    const timedOut = await transport.spawner("__HANG__", "{}", 120);
    expect(timedOut.timedOut).toBe(true);

    const crashed = await transport.spawner("__CRASH__", "{}", 5000);
    expect(crashed.restarted).toBe(true);

    const ok = await transport.spawner("echo", '{"survived":true}', 5000);
    expect(ok.stdout).toBe('{"survived":true}');

    const stats = transport.stats();
    expect(stats.timeouts).toBe(1);
    expect(stats.restarts).toBe(1);
  });
});
