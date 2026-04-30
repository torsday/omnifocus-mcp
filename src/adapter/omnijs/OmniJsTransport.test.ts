/**
 * Unit tests for `OmniJsTransport`.
 *
 * Covers the keystone slice this PR ships:
 * - `runOmniJsScript` (raw escape hatch) round-trips through the runner
 *   with a fake spawner — the wired proof method
 * - Stubbed methods throw the documented `not-yet-wired` ScriptError so
 *   `TransportRouter` (#19) and tests can detect the partial state
 * - The constructor's spawner / timeout options reach the runner
 */

import { describe, expect, it, vi } from "vitest";
import type { ProjectId, TaskId } from "../../domain/ids.js";
import { ScriptError } from "../../errors/index.js";
import { OmniJsTransport } from "./OmniJsTransport.js";
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

describe("OmniJsTransport — runOmniJsScript (wired)", () => {
  it("returns the parsed payload from the underlying runner", async () => {
    const spawner = spawnerReturning('{"pong":true,"omniFocusVersion":"4.8.8"}');
    const t = new OmniJsTransport({ spawner });
    const result = await t.runOmniJsScript("(() => JSON.stringify({pong:true}))()");
    expect(result).toEqual({ pong: true, omniFocusVersion: "4.8.8" });
  });

  it("forwards the configured timeout to the spawner", async () => {
    const spawner = vi.fn(
      async (_body: string, _arg: string, _ms: number): Promise<SpawnResult> => ({
        stdout: '"ok"',
        stderr: "",
        exitCode: 0,
        timedOut: false,
      }),
    );
    const t = new OmniJsTransport({ spawner, timeoutMs: 9999 });
    await t.runOmniJsScript("(() => '\"ok\"')()");
    expect(spawner.mock.calls[0]?.[2]).toBe(9999);
  });

  it("tags raw-script errors with scriptName='raw' for context", async () => {
    const spawner = vi.fn(
      async (): Promise<SpawnResult> => ({
        stdout: "",
        stderr: "boom",
        exitCode: 1,
        timedOut: false,
      }),
    );
    const t = new OmniJsTransport({ spawner });
    const err = await t.runOmniJsScript("bad").catch((e) => e);
    expect(err).toBeInstanceOf(ScriptError);
    expect((err as ScriptError).details).toMatchObject({
      transport: "omnijs",
      scriptName: "raw",
    });
  });
});

describe("OmniJsTransport — not-yet-wired stubs", () => {
  const t = new OmniJsTransport({ spawner: spawnerReturning("{}") });

  // Sample one method per domain group; the per-method shape is uniform.
  // Note: createTask was wired in #680 (ADR-0019); use updateTask for the
  // task-domain stub sample. createProject was wired in #681; use updateProject.
  const cases: Array<readonly [string, () => Promise<unknown>]> = [
    ["listTasks", () => t.listTasks({})],
    ["getTask", () => t.getTask("task_000001" as TaskId)],
    ["updateTask", () => t.updateTask("task_000001" as TaskId, {})],
    ["listProjects", () => t.listProjects()],
    ["getProject", () => t.getProject("proj_000001" as ProjectId)],
    ["listTags", () => t.listTags()],
    ["listFolders", () => t.listFolders()],
    ["syncTrigger", () => t.syncTrigger()],
    ["getLastSync", () => t.getLastSync()],
  ];

  for (const [method, call] of cases) {
    it(`${method} throws ScriptError with reason="not-yet-wired"`, async () => {
      const err = await call().catch((e) => e);
      expect(err).toBeInstanceOf(ScriptError);
      expect((err as ScriptError).details).toMatchObject({
        transport: "omnijs",
        reason: "not-yet-wired",
        method,
      });
    });
  }
});
