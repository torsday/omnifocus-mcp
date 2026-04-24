/**
 * Tests for the `transport.call` event emitted by the JXA + OmniJS script
 * runners (#313). Goldilocks coverage: hash stability, success path on
 * each runner, and error path (exitCode !== 0) on the JXA runner — enough
 * to prove the seam is wired and the outcome classification is correct
 * without re-testing every error branch in the runner.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runJxaScript } from "../adapter/jxa/scriptRunner.js";
import { runOmniJsScript } from "../adapter/omnijs/scriptRunner.js";
import { withCorrelationId } from "./correlation.js";
import { setLogLevel } from "./logger.js";
import { hashArgs } from "./transportCall.js";

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
