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

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { launchFakePersistentChild } from "../../../tests/lib/fakePersistentChild.js";
import { OmniFocusTransportRestarted } from "../../errors/index.js";
import { __resetTransportCircuitsForTest } from "../_shared/transportCircuit.js";
import {
  __PERSISTENT_RUNTIME_SRC_FOR_TEST,
  createPersistentJxaTransport,
} from "./persistentScriptRunner.js";
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

// ---------------------------------------------------------------------------
// Mock child — an in-process EventEmitter with PassThrough pipes, for tests
// that need exact control over chunk boundaries and stream events (the real
// fake child is a separate process, so the OS may coalesce its writes).
// ---------------------------------------------------------------------------

interface MockChild {
  child: ChildProcess;
  stdin: PassThrough;
  stderr: PassThrough;
  fd3: PassThrough;
}

function makeMockChild(): MockChild {
  const stdin = new PassThrough();
  const stderr = new PassThrough();
  const fd3 = new PassThrough();
  const child = new EventEmitter() as unknown as ChildProcess & {
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    killed: boolean;
  };
  Object.assign(child, {
    pid: 424242,
    exitCode: null,
    signalCode: null,
    killed: false,
    stdin,
    stdout: null,
    stderr,
    stdio: [stdin, null, stderr, fd3],
    kill: (signal?: NodeJS.Signals | number): boolean => {
      child.killed = true;
      child.signalCode = typeof signal === "string" ? signal : "SIGTERM";
      child.emit("exit", null, child.signalCode);
      return true;
    },
  });
  return { child, stdin, stderr, fd3 };
}

/** Let pending stream callbacks (data events) drain. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("persistent JXA transport — multibyte UTF-8 split across pipe chunks", () => {
  it("decodes a response frame split mid-emoji across two fd3 data events", async () => {
    const mock = makeMockChild();
    transport = createPersistentJxaTransport(() => mock.child, 20);
    const t = transport;
    const pending = t.spawner("echo", "{}", 5000);

    const frame = Buffer.from(`${JSON.stringify({ ok: true, stdout: "🌍 café" })}\n`, "utf8");
    const splitAt = frame.indexOf(Buffer.from("🌍", "utf8")) + 2; // inside the 4-byte emoji
    mock.fd3.write(frame.subarray(0, splitAt));
    await tick();
    mock.fd3.write(frame.subarray(splitAt));

    const result = await pending;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("🌍 café"); // per-chunk decode yields U+FFFD here
  });

  it("decodes a stderr tail split mid-emoji when surfacing a crash", async () => {
    const mock = makeMockChild();
    transport = createPersistentJxaTransport(() => mock.child, 20);
    const t = transport;
    const pending = t.spawner("echo", "{}", 5000);

    const noise = Buffer.from("boom 💥 stderr", "utf8");
    const splitAt = noise.indexOf(Buffer.from("💥", "utf8")) + 2; // inside the 4-byte emoji
    mock.stderr.write(noise.subarray(0, splitAt));
    await tick();
    mock.stderr.write(noise.subarray(splitAt));
    await tick();
    mock.child.emit("exit", 1, null); // crash mid-call — tail rides the restart

    const result = await pending;
    expect(result.restarted).toBe(true);
    expect(result.stderr).toBe("boom 💥 stderr");
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

describe("persistent runtime dispatch — single execution per script shape", () => {
  // The runtime is a source string evaluated by osascript, but its `dispatch`
  // is plain JS — so its semantics (one execution per call, both shapes) are
  // pinned here by evaluating it in Node. The osascript-specific behavior
  // (run-leak to global, fd-3 framing) is covered against the real binary in
  // persistentScriptRunner.integration.test.ts.
  type Dispatch = (script: string, arg: string) => unknown;

  function extractDispatch(): Dispatch {
    const match = __PERSISTENT_RUNTIME_SRC_FOR_TEST.match(
      /function dispatch\(script, arg\) \{[\s\S]*?\n {2}\}/,
    );
    if (match === null) throw new Error("dispatch not found in runtime source");
    // Indirect eval compiles dispatch in sloppy mode, matching the osascript
    // runtime (this ESM test file is strict; the runtime program is not).
    // biome-ignore lint/security/noGlobalEval: pinning the runtime's eval-based dispatch requires evaluating its source
    return globalThis.eval(`(${match[0]})`) as Dispatch;
  }

  const G = globalThis as Record<string, unknown>;

  afterEach(() => {
    delete G.__exprCount;
    delete G.__topLevelCount;
    delete G.run;
  });

  it("executes an expression-form script exactly once and returns its completion value", () => {
    const dispatch = extractDispatch();
    G.__exprCount = 0;
    const value = dispatch(
      "(() => { globalThis.__exprCount = Number(globalThis.__exprCount) + 1; return 'v'; })()",
      "{}",
    );
    expect(G.__exprCount).toBe(1); // old combined probe-and-execute ran it twice
    expect(value).toBe("v");
  });

  it("runs a run-form script's top-level statements once, then calls run([arg])", () => {
    const dispatch = extractDispatch();
    G.__topLevelCount = 0;
    const value = dispatch(
      "globalThis.__topLevelCount = Number(globalThis.__topLevelCount) + 1;\n" +
        "function run(argv){ return `${argv[0]}:${globalThis.__topLevelCount}`; }",
      '{"a":1}',
    );
    expect(G.__topLevelCount).toBe(1);
    expect(value).toBe('{"a":1}:1');
  });

  it("is not hijacked by a stale global `run` leaked by a previous call", () => {
    const dispatch = extractDispatch();
    G.run = () => "stale";
    const value = dispatch("(() => 'fresh')()", "{}");
    expect(value).toBe("fresh");
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
