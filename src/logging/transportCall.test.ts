/**
 * Tests for the `transport.call` event emitted by the JXA + OmniJS script
 * runners (#313). Goldilocks coverage: hash stability, success path on
 * each runner, and error path (exitCode !== 0) on the JXA runner — enough
 * to prove the seam is wired and the outcome classification is correct
 * without re-testing every error branch in the runner.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetSpawnFloorForTesting } from "../adapter/_shared/spawnFloor.js";
import { runJxaScript } from "../adapter/jxa/scriptRunner.js";
import { runOmniJsScript } from "../adapter/omnijs/scriptRunner.js";
import { withCorrelationId } from "./correlation.js";
import { setLogLevel } from "./logger.js";
import { emitTransportCall, hashArgs } from "./transportCall.js";

// `transport.call` is a debug-level event (PII protection per DESIGN §21).
// Force the singleton logger to debug for the duration of this suite so the
// events surface; restore to info (the singleton's default) on teardown.
beforeEach(() => {
  setLogLevel("debug");
});
afterEach(() => {
  setLogLevel("info");
});

interface CapturedLine {
  level: string;
  event: string;
  transport?: string;
  scriptName?: string;
  argsHash?: string;
  outcome?: string;
  durationMs?: number;
  spawnFloorMs?: number;
  scriptMs?: number;
  correlationId?: string;
}

function captureLogs() {
  const lines: CapturedLine[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    const text = typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf-8");
    for (const raw of text.split("\n")) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as CapturedLine;
        if (parsed.event === "transport.call") lines.push(parsed);
      } catch {
        /* not JSON — ignore */
      }
    }
    return true;
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe("hashArgs", () => {
  it("hashes plain objects deterministically regardless of key order", () => {
    expect(hashArgs({ a: 1, b: 2 })).toBe(hashArgs({ b: 2, a: 1 }));
  });

  it("distinguishes different values", () => {
    expect(hashArgs({ a: 1 })).not.toBe(hashArgs({ a: 2 }));
  });

  it("distinguishes args that differ only at a nested level", () => {
    // Regression: previously the replacer-array form of `JSON.stringify`
    // dropped nested keys, so two semantically-different calls with the
    // same top-level shape collapsed into one transport.call argsHash.
    expect(hashArgs({ id: "X", changes: { name: "P1" } })).not.toBe(
      hashArgs({ id: "X", changes: { name: "P2" } }),
    );
  });

  it("is stable regardless of key order at any nesting level", () => {
    expect(hashArgs({ id: "X", changes: { name: "n", note: "x" } })).toBe(
      hashArgs({ changes: { note: "x", name: "n" }, id: "X" }),
    );
  });

  it("does not crash on null/undefined args and gives them distinct hashes", () => {
    expect(() => hashArgs(null)).not.toThrow();
    expect(() => hashArgs(undefined)).not.toThrow();
    expect(hashArgs(null)).not.toBe(hashArgs(undefined));
  });
});

describe("runJxaScript transport.call event", () => {
  let cap: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    cap = captureLogs();
  });
  afterEach(() => {
    cap.restore();
  });

  it("emits exactly one transport.call event with outcome ok on a clean exit", async () => {
    await withCorrelationId(
      () =>
        runJxaScript(
          "function run(){return JSON.stringify({ok:true});}",
          { foo: 1 },
          {
            scriptName: "test_script",
            spawner: async () => ({
              stdout: '{"ok":true}',
              stderr: "",
              exitCode: 0,
              timedOut: false,
            }),
          },
        ),
      "01J0000000000000000000ABCD",
    );

    expect(cap.lines).toHaveLength(1);
    const [evt] = cap.lines;
    expect(evt?.transport).toBe("jxa");
    expect(evt?.scriptName).toBe("test_script");
    expect(evt?.outcome).toBe("ok");
    expect(evt?.argsHash).toBe(hashArgs({ foo: 1 }));
    expect(evt?.correlationId).toBe("01J0000000000000000000ABCD");
    expect(typeof evt?.durationMs).toBe("number");
  });

  it("emits outcome=error when the script exits non-zero", async () => {
    await expect(
      runJxaScript(
        "function run(){throw 'boom';}",
        { x: 1 },
        {
          scriptName: "broken",
          spawner: async () => ({
            stdout: "",
            stderr: "execution error",
            exitCode: 1,
            timedOut: false,
          }),
        },
      ),
    ).rejects.toThrow();

    const evt = cap.lines.find((l) => l.scriptName === "broken");
    expect(evt?.transport).toBe("jxa");
    expect(evt?.outcome).toBe("error");
  });
});

describe("runOmniJsScript transport.call event", () => {
  let cap: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    cap = captureLogs();
  });
  afterEach(() => {
    cap.restore();
  });

  it("emits exactly one transport.call event with transport=omnijs on a clean exit", async () => {
    await runOmniJsScript(
      "(()=>JSON.stringify({ok:true}))()",
      { y: 2 },
      {
        scriptName: "omnijs_test",
        spawner: async () => ({
          stdout: '{"ok":true}',
          stderr: "",
          exitCode: 0,
          timedOut: false,
        }),
      },
    );

    expect(cap.lines).toHaveLength(1);
    const [evt] = cap.lines;
    expect(evt?.transport).toBe("omnijs");
    expect(evt?.scriptName).toBe("omnijs_test");
    expect(evt?.outcome).toBe("ok");
    expect(evt?.argsHash).toBe(hashArgs({ y: 2 }));
  });
});

describe("emitTransportCall — spawn / script split (#939)", () => {
  let cap: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    __resetSpawnFloorForTesting();
    cap = captureLogs();
  });
  afterEach(() => {
    cap.restore();
  });

  it("omits spawnFloorMs / scriptMs when no floor has been calibrated", () => {
    emitTransportCall("jxa", "x", { a: 1 }, 42, "ok");
    expect(cap.lines).toHaveLength(1);
    expect(cap.lines[0]?.spawnFloorMs).toBeUndefined();
    expect(cap.lines[0]?.scriptMs).toBeUndefined();
    expect(cap.lines[0]?.durationMs).toBe(42);
  });

  it("computes scriptMs = max(0, durationMs - spawnFloorMs) when both are known", () => {
    emitTransportCall("jxa", "x", { a: 1 }, 250, "ok", 100);
    expect(cap.lines).toHaveLength(1);
    expect(cap.lines[0]?.durationMs).toBe(250);
    expect(cap.lines[0]?.spawnFloorMs).toBe(100);
    expect(cap.lines[0]?.scriptMs).toBe(150);
  });

  it("clamps scriptMs to 0 when the floor exceeds the observed duration (system noise)", () => {
    emitTransportCall("omnijs", "x", { a: 1 }, 80, "ok", 100);
    expect(cap.lines[0]?.scriptMs).toBe(0);
  });
});
