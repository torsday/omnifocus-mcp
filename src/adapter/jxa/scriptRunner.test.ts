/**
 * Unit tests for `runJxaScript`.
 *
 * Every test injects a fake `ScriptSpawner` so no real `osascript` runs.
 * The runner's job is the protocol: pass the JSON arg through, parse the
 * stdout, classify stderr signatures into typed errors, time out cleanly.
 * Real-binary integration goes through the harness in #80.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  NotFound,
  OmniFocusError,
  OmniFocusNotRunning,
  PermissionDenied,
  ScriptError,
  TransportUnavailable,
  ValidationError,
} from "../../errors/index.js";
import { runJxaScript, type ScriptSpawner, type SpawnResult } from "./scriptRunner.js";

function fakeSpawner(result: Partial<SpawnResult>): ScriptSpawner {
  return vi.fn(
    async (): Promise<SpawnResult> => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      ...result,
    }),
  );
}

describe("runJxaScript — happy path", () => {
  it("parses JSON stdout into the typed result", async () => {
    const spawner = fakeSpawner({ stdout: '{"ok":true,"n":42}' });
    const out = await runJxaScript<{ ok: boolean; n: number }>("script", {}, { spawner });
    expect(out).toEqual({ ok: true, n: 42 });
  });

  it("forwards args as a JSON string in argv[0]", async () => {
    const spawner = vi.fn(
      async (_body: string, _arg: string, _ms: number): Promise<SpawnResult> => ({
        stdout: '"ok"',
        stderr: "",
        exitCode: 0,
        timedOut: false,
      }),
    );
    await runJxaScript("script", { name: "buy milk", flagged: true }, { spawner });
    expect(spawner).toHaveBeenCalledOnce();
    const [, jsonArg] = spawner.mock.calls[0] ?? [];
    expect(jsonArg).toBe('{"name":"buy milk","flagged":true}');
  });

  it("trims surrounding whitespace before parsing", async () => {
    const spawner = fakeSpawner({ stdout: '\n  {"x":1}\n' });
    const out = await runJxaScript("script", {}, { spawner });
    expect(out).toEqual({ x: 1 });
  });

  it("defaults args to {} when omitted", async () => {
    const spawner = vi.fn(
      async (_body: string, _arg: string, _ms: number): Promise<SpawnResult> => ({
        stdout: '"ok"',
        stderr: "",
        exitCode: 0,
        timedOut: false,
      }),
    );
    await runJxaScript("script", undefined, { spawner });
    expect(spawner.mock.calls[0]?.[1]).toBe("{}");
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
    await runJxaScript("script", {}, { spawner, timeoutMs: 5000 });
    expect(spawner.mock.calls[0]?.[2]).toBe(5000);
  });
});

describe("runJxaScript — error mapping", () => {
  it("maps timeout to Timeout with transport context", async () => {
    const spawner = fakeSpawner({ timedOut: true, exitCode: 1 });
    await expect(runJxaScript("script", {}, { spawner, timeoutMs: 250 })).rejects.toMatchObject({
      name: "Timeout",
      code: "OF_TIMEOUT",
      details: { transport: "jxa", timeoutMs: 250 },
    });
  });

  it("maps spawn ENOENT to TransportUnavailable", async () => {
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" }) as NodeJS.ErrnoException;
    const spawner = fakeSpawner({ exitCode: 1, spawnError: enoent });
    await expect(runJxaScript("script", {}, { spawner })).rejects.toBeInstanceOf(
      TransportUnavailable,
    );
  });

  it("maps 'Application isn't running' stderr to OmniFocusNotRunning", async () => {
    const spawner = fakeSpawner({
      exitCode: 1,
      stderr: "OmniFocus got an error: Application isn't running.",
    });
    await expect(runJxaScript("script", {}, { spawner })).rejects.toBeInstanceOf(
      OmniFocusNotRunning,
    );
  });

  it("maps -1743 (errAEEventNotPermitted) stderr to PermissionDenied", async () => {
    const spawner = fakeSpawner({
      exitCode: 1,
      stderr: "execution error: Not authorized to send Apple events to OmniFocus. (-1743)",
    });
    await expect(runJxaScript("script", {}, { spawner })).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("maps unclassified non-zero exit to ScriptError carrying stderr", async () => {
    const spawner = fakeSpawner({ exitCode: 2, stderr: "some other failure mode" });
    const err = await runJxaScript("script", {}, { spawner, scriptName: "task_list" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ScriptError);
    expect((err as ScriptError).details).toMatchObject({
      transport: "jxa",
      exitCode: 2,
      scriptName: "task_list",
    });
    expect((err as ScriptError).details?.stderr).toContain("some other failure mode");
  });

  it("maps malformed stdout JSON to ScriptError with a preview", async () => {
    const spawner = fakeSpawner({ stdout: "not-json{}" });
    const err = await runJxaScript("script", {}, { spawner }).catch((e) => e);
    expect(err).toBeInstanceOf(ScriptError);
    expect((err as ScriptError).details?.stdoutPreview).toContain("not-json");
  });

  it("maps empty stdout to ScriptError (script-author bug)", async () => {
    const spawner = fakeSpawner({ stdout: "   \n" });
    await expect(runJxaScript("script", {}, { spawner })).rejects.toBeInstanceOf(ScriptError);
  });

  it("every thrown error is in the typed taxonomy (never raw Error)", async () => {
    const cases: Array<Partial<SpawnResult>> = [
      { timedOut: true, exitCode: 1 },
      { exitCode: 1, stderr: "Application isn't running" },
      { exitCode: 1, stderr: "Not authorized to send Apple events (-1743)" },
      { exitCode: 5, stderr: "boom" },
      { stdout: "garbage" },
      { stdout: "" },
    ];
    for (const c of cases) {
      const spawner = fakeSpawner(c);
      const err = await runJxaScript("script", {}, { spawner }).catch((e) => e);
      expect(err).toBeInstanceOf(OmniFocusError);
    }
  });
});

// ---------------------------------------------------------------------------
// classifyJxaStderr — NotFound / ValidationError / ConflictError patterns
// ---------------------------------------------------------------------------

describe("runJxaScript — error taxonomy: NotFound", () => {
  it("maps 'Task not found: <id>' to NotFound", async () => {
    const spawner = fakeSpawner({ exitCode: 1, stderr: "Task not found: abc123" });
    await expect(runJxaScript("s", {}, { spawner })).rejects.toBeInstanceOf(NotFound);
  });

  it("maps 'Project not found: <id>' to NotFound", async () => {
    const spawner = fakeSpawner({ exitCode: 1, stderr: "Project not found: xyz" });
    await expect(runJxaScript("s", {}, { spawner })).rejects.toBeInstanceOf(NotFound);
  });

  it("maps 'Folder not found: <id>' to NotFound", async () => {
    const spawner = fakeSpawner({ exitCode: 1, stderr: "Folder not found: fid" });
    await expect(runJxaScript("s", {}, { spawner })).rejects.toBeInstanceOf(NotFound);
  });

  it("maps 'Tag not found: <id>' to NotFound", async () => {
    const spawner = fakeSpawner({ exitCode: 1, stderr: "Tag not found: tid" });
    await expect(runJxaScript("s", {}, { spawner })).rejects.toBeInstanceOf(NotFound);
  });

  it("maps 'Parent task not found: <id>' to NotFound", async () => {
    const spawner = fakeSpawner({ exitCode: 1, stderr: "Parent task not found: pid" });
    await expect(runJxaScript("s", {}, { spawner })).rejects.toBeInstanceOf(NotFound);
  });

  it("maps 'OF_NOT_FOUND: project <id>' (batch scripts) to NotFound", async () => {
    const spawner = fakeSpawner({ exitCode: 1, stderr: "OF_NOT_FOUND: project abc" });
    await expect(runJxaScript("s", {}, { spawner })).rejects.toBeInstanceOf(NotFound);
  });

  // #674: OmniFocus's native missing-id surface. JXA's `byId(...)` returns a
  // lazy specifier; the lookup fires on the first method call and throws
  // `Can't get object. (-1728)`. Without this mapping, every JXA-routed
  // mutation that takes a target id (project, task, folder, tag) returned
  // opaque ScriptError instead of typed NotFound — surfaced live by the
  // integration suite which has been red since v1.0.0 on the `createTask
  // with an unknown projectId throws NotFound` contract.
  it("maps 'Error: Can't get object. (-1728)' to NotFound (JXA byId miss)", async () => {
    const spawner = fakeSpawner({
      exitCode: 1,
      stderr: "execution error: Error: Error: Can't get object. (-1728)",
    });
    await expect(runJxaScript("s", {}, { spawner })).rejects.toBeInstanceOf(NotFound);
  });

  it("maps the bare error code (-1728) without the prose to NotFound", async () => {
    const spawner = fakeSpawner({
      exitCode: 1,
      stderr: "OmniFocus got an error: AppleEvent failed (-1728)",
    });
    await expect(runJxaScript("s", {}, { spawner })).rejects.toBeInstanceOf(NotFound);
  });
});

describe("runJxaScript — error taxonomy: ValidationError", () => {
  it("maps 'OF_VALIDATION: ...' to ValidationError", async () => {
    const spawner = fakeSpawner({ exitCode: 1, stderr: "OF_VALIDATION: name is empty" });
    await expect(runJxaScript("s", {}, { spawner })).rejects.toBeInstanceOf(ValidationError);
  });

  it("maps 'X is required' patterns to ValidationError", async () => {
    const spawner = fakeSpawner({
      exitCode: 1,
      stderr: "One of taskId or projectId is required",
    });
    await expect(runJxaScript("s", {}, { spawner })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("runJxaScript — error taxonomy: ConflictError", () => {
  it("maps 'OF_CONFLICT: ...' to ConflictError", async () => {
    const spawner = fakeSpawner({ exitCode: 1, stderr: "OF_CONFLICT: stale modifiedAt" });
    await expect(runJxaScript("s", {}, { spawner })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("runJxaScript — error taxonomy: no false positives", () => {
  it("does not map generic non-zero exit to NotFound", async () => {
    const spawner = fakeSpawner({ exitCode: 1, stderr: "unexpected JXA crash" });
    await expect(runJxaScript("s", {}, { spawner })).rejects.toBeInstanceOf(ScriptError);
  });
});

// ---------------------------------------------------------------------------
// Retry-once on transient failures (#816)
// ---------------------------------------------------------------------------

describe("runJxaScript — retry-once on transient failures", () => {
  /**
   * Sequenced spawner: returns the first result on call N=1, the second on
   * N=2, etc. Asserts the right number of attempts via `mock.calls.length`.
   * Typed as `ScriptSpawner` for compatibility with `RunScriptOptions.spawner`
   * while still exposing the `MockInstance.mock` surface to callers.
   */
  function sequenceSpawner(
    ...results: Partial<SpawnResult>[]
  ): ScriptSpawner & ReturnType<typeof vi.fn> {
    const sequence: SpawnResult[] = results.map((r) => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      ...r,
    }));
    let i = 0;
    return vi.fn(
      async (_b: string, _a: string, _t: number): Promise<SpawnResult> =>
        sequence[i++] as SpawnResult,
    ) as ScriptSpawner & ReturnType<typeof vi.fn>;
  }

  it("retries a read-only script on timeout and returns the second-attempt result", async () => {
    const spawner = sequenceSpawner({ timedOut: true }, { stdout: '{"ok":true}' });
    const out = await runJxaScript<{ ok: true }>(
      "script",
      {},
      { spawner, scriptName: "task_get", retry: { delayMs: 0 } },
    );
    expect(out).toEqual({ ok: true });
    expect(spawner.mock.calls).toHaveLength(2);
  });

  it("retries on stderr containing -1728 (errAENoSuchObject) for a read-only script", async () => {
    const spawner = sequenceSpawner(
      { exitCode: 1, stderr: "Error: Can't get object. (-1728)" },
      { stdout: '{"task":{"id":"abc"}}' },
    );
    const out = await runJxaScript<{ task: { id: string } }>(
      "script",
      {},
      { spawner, scriptName: "task_get", retry: { delayMs: 0 } },
    );
    expect(out).toEqual({ task: { id: "abc" } });
    expect(spawner.mock.calls).toHaveLength(2);
  });

  it("retries on stderr containing -10024", async () => {
    const spawner = sequenceSpawner(
      { exitCode: 1, stderr: "Error: AccessorNotFound (-10024)" },
      { stdout: '{"projects":[]}' },
    );
    const out = await runJxaScript(
      "script",
      {},
      {
        spawner,
        scriptName: "project_list",
        retry: { delayMs: 0 },
      },
    );
    expect(out).toEqual({ projects: [] });
    expect(spawner.mock.calls).toHaveLength(2);
  });

  it("retries on stderr containing -10003", async () => {
    const spawner = sequenceSpawner(
      { exitCode: 1, stderr: "Error: NotModifiable (-10003)" },
      { stdout: '{"tags":[]}' },
    );
    const out = await runJxaScript(
      "script",
      {},
      {
        spawner,
        scriptName: "tag_list",
        retry: { delayMs: 0 },
      },
    );
    expect(out).toEqual({ tags: [] });
    expect(spawner.mock.calls).toHaveLength(2);
  });

  it("does NOT retry a write-shaped script even when the failure is transient", async () => {
    const spawner = sequenceSpawner({ timedOut: true });
    await expect(
      runJxaScript(
        "script",
        {},
        {
          spawner,
          scriptName: "task_create",
          retry: { delayMs: 0 },
        },
      ),
    ).rejects.toBeInstanceOf(OmniFocusError);
    expect(spawner.mock.calls).toHaveLength(1);
  });

  it("does NOT retry when scriptName is unknown (safe default)", async () => {
    const spawner = sequenceSpawner({ timedOut: true });
    await expect(
      runJxaScript("script", {}, { spawner, retry: { delayMs: 0 } }),
    ).rejects.toBeInstanceOf(OmniFocusError);
    expect(spawner.mock.calls).toHaveLength(1);
  });

  it("does NOT retry when retry.enabled is false", async () => {
    const spawner = sequenceSpawner({ timedOut: true });
    await expect(
      runJxaScript(
        "script",
        {},
        {
          spawner,
          scriptName: "task_get",
          retry: { enabled: false, delayMs: 0 },
        },
      ),
    ).rejects.toBeInstanceOf(OmniFocusError);
    expect(spawner.mock.calls).toHaveLength(1);
  });

  it("does NOT retry on non-transient errors (e.g. PermissionDenied)", async () => {
    const spawner = sequenceSpawner({
      exitCode: 1,
      stderr: "Not authorized to send Apple events",
    });
    await expect(
      runJxaScript(
        "script",
        {},
        {
          spawner,
          scriptName: "task_get",
          retry: { delayMs: 0 },
        },
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    expect(spawner.mock.calls).toHaveLength(1);
  });

  it("on second-attempt failure, throws the second result's typed error (no wrapping)", async () => {
    // Two consecutive timeouts — the second attempt's Timeout is what surfaces.
    const spawner = sequenceSpawner({ timedOut: true }, { timedOut: true });
    const err = await runJxaScript(
      "script",
      {},
      {
        spawner,
        scriptName: "task_get",
        retry: { delayMs: 0 },
      },
    ).catch((e: unknown) => e);
    expect((err as Error).constructor.name).toBe("Timeout");
    expect(spawner.mock.calls).toHaveLength(2);
  });

  it("does NOT retry on spawn failure (binary missing — not transient)", async () => {
    const spawnErr = Object.assign(new Error("ENOENT"), {
      code: "ENOENT",
    }) as NodeJS.ErrnoException;
    const spawner = sequenceSpawner({ exitCode: 127, spawnError: spawnErr });
    await expect(
      runJxaScript(
        "script",
        {},
        {
          spawner,
          scriptName: "task_get",
          retry: { delayMs: 0 },
        },
      ),
    ).rejects.toBeInstanceOf(TransportUnavailable);
    expect(spawner.mock.calls).toHaveLength(1);
  });
});

describe("READ_ONLY_JXA_SCRIPTS — coverage pin", () => {
  it("includes every documented read-shaped script name", async () => {
    const { READ_ONLY_JXA_SCRIPTS } = await import("./scriptRunner.js");
    // Pin the set so additions are visible in review. New read-shaped scripts
    // need to be added here to benefit from the retry-once policy.
    expect([...READ_ONLY_JXA_SCRIPTS].sort()).toEqual([
      "attachment_list",
      "changes_since",
      "folder_get",
      "folder_list",
      "forecast_get",
      "perspective_evaluate",
      "perspective_list",
      "ping",
      "project_get",
      "project_get_many",
      "project_list",
      "review_list_due",
      "tag_get",
      "tag_get_many",
      "tag_list",
      "task_get",
      "task_get_many",
      "task_list",
      "task_search",
      "window_get_state",
    ]);
  });
});
