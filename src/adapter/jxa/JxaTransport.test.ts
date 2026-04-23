/**
 * Unit tests for `JxaTransport`.
 *
 * Covers the keystone slice this PR ships:
 * - `syncTrigger` round-trips through the runner with a fake spawner
 * - Stubbed methods throw the documented `not-yet-wired` ScriptError so
 *   `TransportRouter` (#19) and tests can detect the partial state
 * - The constructor's spawner / timeout options reach the runner
 */

import { describe, expect, it, vi } from "vitest";
import { ScriptError } from "../../errors/index.js";
import { JxaTransport } from "./JxaTransport.js";
import type { ScriptSpawner, SpawnResult } from "./scriptRunner.js";

function spawnerReturning(stdout: string): ScriptSpawner {
  return vi.fn(
    async (): Promise<SpawnResult> => ({
      stdout,
      stderr: "",
      exitCode: 0,
      timedOut: false,
    }),
  );
}

describe("JxaTransport — syncTrigger (wired)", () => {
  it("returns the parsed SyncStatus from the underlying script", async () => {
    const spawner = spawnerReturning('{"lastSyncAt":"2026-04-21T12:00:00.000Z","inFlight":false}');
    const t = new JxaTransport({ spawner });
    const status = await t.syncTrigger();
    expect(status).toEqual({ lastSyncAt: "2026-04-21T12:00:00.000Z", inFlight: false });
  });

  it("forwards the configured timeout to the spawner", async () => {
    const spawner = vi.fn(
      async (_body: string, _arg: string, _ms: number): Promise<SpawnResult> => ({
        stdout: '{"lastSyncAt":null,"inFlight":false}',
        stderr: "",
        exitCode: 0,
        timedOut: false,
      }),
    );
    const t = new JxaTransport({ spawner, timeoutMs: 1234 });
    await t.syncTrigger();
    expect(spawner.mock.calls[0]?.[2]).toBe(1234);
  });

  it("passes scriptName='sync_trigger' for error context", async () => {
    // We verify the runner was invoked with the correct scriptName tag by
    // forcing a script error and inspecting the typed error's details.
    const spawner = vi.fn(
      async (): Promise<SpawnResult> => ({
        stdout: "",
        stderr: "boom",
        exitCode: 1,
        timedOut: false,
      }),
    );
    const t = new JxaTransport({ spawner });
    const err = await t.syncTrigger().catch((e) => e);
    expect(err).toBeInstanceOf(ScriptError);
    expect((err as ScriptError).details).toMatchObject({ scriptName: "sync_trigger" });
  });
});

describe("JxaTransport — getLastSync (interim)", () => {
  it("returns a null status until the lifecycle layer (#25) lands", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning("{}") });
    expect(await t.getLastSync()).toEqual({ lastSyncAt: null, inFlight: false });
  });
});

// All task, project, tag, and folder methods are now wired.
// Per-domain unit tests live in JxaTransport.{tasks,projects,tags-folders}.test.ts.
// No not-yet-wired stubs remain for domain methods.
