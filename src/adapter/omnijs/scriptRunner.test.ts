/**
 * Unit tests for `runOmniJsScript`.
 *
 * Every test injects a fake `ScriptSpawner` so no real `osascript` runs.
 * The runner's job is the protocol: wrap the OmniJS script in the JXA
 * `evaluateJavascript` envelope, parse stdout, classify stderr signatures
 * into typed errors, time out cleanly. Real-binary integration goes through
 * the harness in #80.
 */

import { describe, expect, it, vi } from "vitest";
import {
  OmniFocusError,
  OmniFocusNotRunning,
  PermissionDenied,
  ScriptError,
  Timeout,
  TransportUnavailable,
} from "../../errors/index.js";
import {
  runOmniJsScript,
  type ScriptSpawner,
  type SpawnResult,
  wrapOmniJsForJxa,
} from "./scriptRunner.js";

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

describe("runOmniJsScript — happy path", () => {
  it("parses JSON stdout into the typed result", async () => {
    const spawner = fakeSpawner({ stdout: '{"pong":true,"n":7}' });
    const out = await runOmniJsScript<{ pong: boolean; n: number }>("script", {}, { spawner });
    expect(out).toEqual({ pong: true, n: 7 });
  });

  it("trims surrounding whitespace before parsing", async () => {
    const spawner = fakeSpawner({ stdout: '\n  {"x":1}\n' });
    const out = await runOmniJsScript("script", {}, { spawner });
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
    await runOmniJsScript("script", undefined, { spawner });
    // The runner forwards argsJson="{}" to the spawner for symmetry; the
    // wrapper itself also embeds the args (asserted in the wrapper section).
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
    await runOmniJsScript("script", {}, { spawner, timeoutMs: 7500 });
    expect(spawner.mock.calls[0]?.[2]).toBe(7500);
  });

  it("uses a 45s default timeout when none configured", async () => {
    const spawner = vi.fn(
      async (_body: string, _arg: string, _ms: number): Promise<SpawnResult> => ({
        stdout: '"ok"',
        stderr: "",
        exitCode: 0,
        timedOut: false,
      }),
    );
    await runOmniJsScript("script", {}, { spawner });
    expect(spawner.mock.calls[0]?.[2]).toBe(45_000);
  });
});

describe("runOmniJsScript — error mapping", () => {
  it("maps timeout to Timeout with omnijs transport context", async () => {
    const spawner = fakeSpawner({ timedOut: true, exitCode: 1 });
    const err = await runOmniJsScript("script", {}, { spawner, timeoutMs: 250 }).catch((e) => e);
    expect(err).toBeInstanceOf(Timeout);
    expect((err as Timeout).details).toMatchObject({ transport: "omnijs", timeoutMs: 250 });
  });

  it("maps spawn ENOENT to TransportUnavailable", async () => {
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" }) as NodeJS.ErrnoException;
    const spawner = fakeSpawner({ exitCode: 1, spawnError: enoent });
    await expect(runOmniJsScript("script", {}, { spawner })).rejects.toBeInstanceOf(
      TransportUnavailable,
    );
  });

  it("maps 'Application isn't running' stderr to OmniFocusNotRunning", async () => {
    const spawner = fakeSpawner({
      exitCode: 1,
      stderr: "OmniFocus got an error: Application isn't running.",
    });
    await expect(runOmniJsScript("script", {}, { spawner })).rejects.toBeInstanceOf(
      OmniFocusNotRunning,
    );
  });

  it("maps -1743 (errAEEventNotPermitted) stderr to PermissionDenied", async () => {
    const spawner = fakeSpawner({
      exitCode: 1,
      stderr: "execution error: Not authorized to send Apple events to OmniFocus. (-1743)",
    });
    await expect(runOmniJsScript("script", {}, { spawner })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it("maps an OmniJS thrown error to ScriptError carrying stderr", async () => {
    // The OmniJS spike documents thrown errors surfacing as
    // `execution error: Error: Error: Error: <message> undefined:1:1 (3)`.
    // We don't try to parse out the inner message — we surface the stderr.
    const spawner = fakeSpawner({
      exitCode: 1,
      stderr: "execution error: Error: Error: Error: missing semicolon undefined:1:1 (3)",
    });
    const err = await runOmniJsScript("script", {}, { spawner, scriptName: "ping" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ScriptError);
    expect((err as ScriptError).details).toMatchObject({
      transport: "omnijs",
      scriptName: "ping",
    });
    expect((err as ScriptError).details?.stderr).toContain("missing semicolon");
  });

  it("maps malformed stdout JSON to ScriptError with a preview", async () => {
    const spawner = fakeSpawner({ stdout: "not-json{}" });
    const err = await runOmniJsScript("script", {}, { spawner }).catch((e) => e);
    expect(err).toBeInstanceOf(ScriptError);
    expect((err as ScriptError).details?.stdoutPreview).toContain("not-json");
  });

  it("maps empty stdout to ScriptError (script-author bug)", async () => {
    const spawner = fakeSpawner({ stdout: "   \n" });
    await expect(runOmniJsScript("script", {}, { spawner })).rejects.toBeInstanceOf(ScriptError);
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
      const err = await runOmniJsScript("script", {}, { spawner }).catch((e) => e);
      expect(err).toBeInstanceOf(OmniFocusError);
    }
  });
});

describe("wrapOmniJsForJxa", () => {
  it("embeds the OmniJS body and args as a JXA evaluateJavascript call", () => {
    const wrapped = wrapOmniJsForJxa("return JSON.stringify({n: __args.n});", '{"n":42}');
    // Forms a `function run` JXA entry point.
    expect(wrapped).toContain("function run(_argv)");
    // Calls evaluateJavascript on OmniFocus.
    expect(wrapped).toContain('Application("OmniFocus")');
    expect(wrapped).toContain("evaluateJavascript");
    // Embeds the args installation prefix.
    expect(wrapped).toContain("globalThis.__args =");
    expect(wrapped).toContain('{\\"n\\":42}');
    // Embeds the original OmniJS script body.
    expect(wrapped).toContain("return JSON.stringify({n: __args.n});");
  });

  it("safely round-trips quotes, newlines, and backslashes via JSON.stringify", () => {
    const tricky = 'return "he said \\"hi\\"\\nand \\\\";';
    const wrapped = wrapOmniJsForJxa(tricky, "{}");
    // The script body and args appear as JSON.stringify'd strings, never raw,
    // so a closing quote inside the body cannot break out of the wrapper.
    expect(wrapped).not.toContain('"he said "hi"');
    // Re-parsing the JSON-encoded payload yields the exact original body
    // (with the args prefix prepended).
    const match = wrapped.match(/const __omnijs = (".*");/);
    expect(match).not.toBeNull();
    const decoded = JSON.parse((match as RegExpMatchArray)[1] as string);
    expect(decoded).toBe(`globalThis.__args = {};\n${tricky}`);
  });
});

// ---------------------------------------------------------------------------
// Retry-once on transient failures (#890; mirror of #816 for JXA)
// ---------------------------------------------------------------------------

describe("runOmniJsScript — retry-once on transient failures", () => {
  /**
   * Sequenced spawner: returns the first result on call N=1, the second on
   * N=2, etc. Asserts the right number of attempts via `mock.calls.length`.
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
    const out = await runOmniJsScript<{ ok: true }>(
      "script",
      {},
      { spawner, scriptName: "perspective_evaluate", retry: { delayMs: 0 } },
    );
    expect(out).toEqual({ ok: true });
    expect(spawner.mock.calls).toHaveLength(2);
  });

  it("does NOT retry a write-shaped script even on transient failure", async () => {
    const spawner = sequenceSpawner({ timedOut: true });
    await expect(
      runOmniJsScript(
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
      runOmniJsScript("script", {}, { spawner, retry: { delayMs: 0 } }),
    ).rejects.toBeInstanceOf(OmniFocusError);
    expect(spawner.mock.calls).toHaveLength(1);
  });

  it("does NOT retry when retry.enabled is false", async () => {
    const spawner = sequenceSpawner({ timedOut: true });
    await expect(
      runOmniJsScript(
        "script",
        {},
        {
          spawner,
          scriptName: "perspective_evaluate",
          retry: { enabled: false, delayMs: 0 },
        },
      ),
    ).rejects.toBeInstanceOf(OmniFocusError);
    expect(spawner.mock.calls).toHaveLength(1);
  });

  it("does NOT retry on non-transient errors (e.g. PermissionDenied via stderr)", async () => {
    const spawner = sequenceSpawner({
      exitCode: 1,
      stderr: "Not authorized to send Apple events",
    });
    await expect(
      runOmniJsScript(
        "script",
        {},
        {
          spawner,
          scriptName: "perspective_evaluate",
          retry: { delayMs: 0 },
        },
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
    expect(spawner.mock.calls).toHaveLength(1);
  });

  it("on second-attempt timeout, throws Timeout (no wrapping)", async () => {
    const spawner = sequenceSpawner({ timedOut: true }, { timedOut: true });
    const err = await runOmniJsScript(
      "script",
      {},
      {
        spawner,
        scriptName: "perspective_evaluate",
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
      runOmniJsScript(
        "script",
        {},
        {
          spawner,
          scriptName: "perspective_evaluate",
          retry: { delayMs: 0 },
        },
      ),
    ).rejects.toBeInstanceOf(TransportUnavailable);
    expect(spawner.mock.calls).toHaveLength(1);
  });
});

describe("READ_ONLY_OMNIJS_SCRIPTS — coverage pin", () => {
  it("includes every documented read-shaped OmniJS script name", async () => {
    const { READ_ONLY_OMNIJS_SCRIPTS } = await import("./scriptRunner.js");
    // Pin the set so additions are visible in review. New read-shaped
    // OmniJS scripts need to be added here to benefit from the
    // retry-once policy.
    expect([...READ_ONLY_OMNIJS_SCRIPTS].sort()).toEqual([
      "forecast_get_tag",
      "perspective_evaluate",
      "perspective_evaluate_dry_run",
      "perspective_get",
      "ping",
    ]);
  });
});
