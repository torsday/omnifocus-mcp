/**
 * Transport chaos tests.
 *
 * Exercises every DESIGN §19 failure mode through both `JxaTransport` and
 * `OmniJsTransport` using the injected `ScriptSpawner` seam. The transports
 * never touch real `osascript` — `chaosSpawner(mode)` synthesises the raw
 * `SpawnResult` that the script runners consume, and the test asserts the
 * domain-level outcome is the correct typed error from the taxonomy
 * (DESIGN §6.7): class, `code`, `remediationClass`, and a non-empty
 * `suggestion` the agent can act on.
 *
 * A final case wraps repeated transport failures through a `CircuitBreaker`
 * with `failureThreshold: 3` and verifies the 4th call fast-fails with
 * `CircuitOpen` — proving the chaos harness composes with the breaker
 * (DESIGN §6.10).
 *
 * @see tests/chaos/chaosSpawner.ts
 * @see src/errors/index.ts          — typed error taxonomy
 * @see src/server/circuitBreaker.ts — circuit breaker
 */

import { beforeEach, describe, expect, it } from "vitest";
import { __resetTransportCircuitsForTest } from "../../src/adapter/_shared/transportCircuit.js";
import { JxaTransport } from "../../src/adapter/jxa/JxaTransport.js";
import { OmniJsTransport } from "../../src/adapter/omnijs/OmniJsTransport.js";
import type { TaskId } from "../../src/domain/ids.js";
import {
  CircuitOpen,
  OmniFocusError,
  OmniFocusNotRunning,
  PermissionDenied,
  ScriptError,
  Timeout,
  TransportUnavailable,
} from "../../src/errors/index.js";
import { CircuitBreaker } from "../../src/server/circuitBreaker.js";
import {
  type ChaosMode,
  chaosSpawner,
  okResult,
  sequencedSpawner,
  TIMEOUT_RESULT,
} from "./chaosSpawner.js";

// ---------------------------------------------------------------------------
// Expectation table — one row per failure mode.
// ---------------------------------------------------------------------------

interface ExpectedError {
  readonly ctor: new (...args: never[]) => OmniFocusError;
  readonly code: string;
  readonly remediationClass: string;
}

const EXPECTATIONS: Record<ChaosMode, ExpectedError> = {
  "of-not-running": {
    ctor: OmniFocusNotRunning,
    code: "OF_NOT_RUNNING",
    remediationClass: "environment",
  },
  "permission-denied": {
    ctor: PermissionDenied,
    code: "OF_PERMISSION_DENIED",
    remediationClass: "environment",
  },
  timeout: {
    ctor: Timeout,
    code: "OF_TIMEOUT",
    remediationClass: "transient",
  },
  "malformed-json": {
    ctor: ScriptError,
    code: "OF_SCRIPT_ERROR",
    remediationClass: "infrastructure",
  },
  "spawn-enoent": {
    ctor: TransportUnavailable,
    code: "OF_TRANSPORT_UNAVAILABLE",
    remediationClass: "infrastructure",
  },
  "empty-stdout": {
    ctor: ScriptError,
    code: "OF_SCRIPT_ERROR",
    remediationClass: "infrastructure",
  },
  "generic-script-error": {
    ctor: ScriptError,
    code: "OF_SCRIPT_ERROR",
    remediationClass: "infrastructure",
  },
};

const MODES = Object.keys(EXPECTATIONS) as ChaosMode[];

// ---------------------------------------------------------------------------
// JxaTransport — drive via `listTasks` (a simple wired read).
// ---------------------------------------------------------------------------

describe("chaos — JxaTransport typed-error mapping", () => {
  for (const mode of MODES) {
    it(`maps "${mode}" to ${EXPECTATIONS[mode].ctor.name}`, async () => {
      const transport = new JxaTransport({ spawner: chaosSpawner(mode), timeoutMs: 100 });
      const err = await transport.listTasks({}).catch((e: unknown) => e);
      const expected = EXPECTATIONS[mode];

      expect(err).toBeInstanceOf(expected.ctor);
      expect(err).toBeInstanceOf(OmniFocusError);
      const of = err as OmniFocusError;
      expect(of.code).toBe(expected.code);
      expect(of.remediationClass).toBe(expected.remediationClass);
      expect(typeof of.suggestion).toBe("string");
      expect((of.suggestion ?? "").length).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// OmniJsTransport — drive via `pluginInvoke` (the one wired surface).
// ---------------------------------------------------------------------------

describe("chaos — OmniJsTransport typed-error mapping", () => {
  for (const mode of MODES) {
    it(`maps "${mode}" to ${EXPECTATIONS[mode].ctor.name}`, async () => {
      const transport = new OmniJsTransport({ spawner: chaosSpawner(mode), timeoutMs: 100 });
      const err = await transport
        .pluginInvoke({ identifier: "com.example.plugin/noop" })
        .catch((e: unknown) => e);
      const expected = EXPECTATIONS[mode];

      expect(err).toBeInstanceOf(expected.ctor);
      expect(err).toBeInstanceOf(OmniFocusError);
      const of = err as OmniFocusError;
      expect(of.code).toBe(expected.code);
      expect(of.remediationClass).toBe(expected.remediationClass);
      expect(typeof of.suggestion).toBe("string");
      expect((of.suggestion ?? "").length).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Circuit breaker composition — sustained failures must open the circuit.
// ---------------------------------------------------------------------------

describe("chaos — sustained failures open the circuit breaker", () => {
  it("opens after failureThreshold failures and fast-fails the next call", async () => {
    const transport = new JxaTransport({
      spawner: chaosSpawner("generic-script-error"),
      timeoutMs: 100,
    });
    const breaker = new CircuitBreaker("chaos-test", {
      failureThreshold: 3,
      windowMs: 60_000,
      openDurationMs: 60_000,
    });

    // Three real calls — each fails with ScriptError and is counted.
    for (let i = 0; i < 3; i++) {
      const err = await breaker.call(() => transport.listTasks({})).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ScriptError);
    }
    expect(breaker.state).toBe("open");

    // Fourth call never reaches the transport; the breaker rejects it.
    const fastFail = await breaker.call(() => transport.listTasks({})).catch((e: unknown) => e);
    expect(fastFail).toBeInstanceOf(CircuitOpen);
    expect((fastFail as CircuitOpen).code).toBe("OF_CIRCUIT_OPEN");
    expect((fastFail as CircuitOpen).remediationClass).toBe("transient");
    expect((fastFail as CircuitOpen).details?.retryAfterMs).toBeTypeOf("number");
  });

  it("recovers to closed after a half-open probe succeeds", async () => {
    // Shared mutable mode lets the spawner flip from failing → healthy.
    let healthy = false;
    const mixedSpawner: import("../../src/adapter/jxa/scriptRunner.js").ScriptSpawner = async () =>
      healthy
        ? { stdout: '{"tasks":[]}', stderr: "", exitCode: 0, timedOut: false }
        : {
            stdout: "",
            stderr: "some unclassified failure",
            exitCode: 2,
            timedOut: false,
          };

    const transport = new JxaTransport({ spawner: mixedSpawner, timeoutMs: 100 });
    // Tight open duration so half-open is reachable inside the 5s test budget.
    const breaker = new CircuitBreaker("chaos-recover", {
      failureThreshold: 2,
      windowMs: 60_000,
      openDurationMs: 10,
    });

    // Drive it open.
    for (let i = 0; i < 2; i++) {
      await breaker.call(() => transport.listTasks({})).catch(() => void 0);
    }
    expect(breaker.state).toBe("open");

    // Wait past openDurationMs so the next read transitions to half-open.
    await new Promise<void>((r) => setTimeout(r, 25));
    healthy = true;
    const tasks = await breaker.call(() => transport.listTasks({}));
    expect(tasks).toEqual([]);
    expect(breaker.state).toBe("closed");
  });
});

// ---------------------------------------------------------------------------
// Slow-first-call recovery (#887)
//
// The integration suite intermittently failed with a JXA Timeout on the
// first `task_get` of a run — cold-start latency or runner contention, not
// a logic bug (the failing test was always the suite's first contract read).
// `task_get` is a read-only script, so `runJxaScript` retries once on a
// transient timeout (#816). These tests pin that the retry transparently
// recovers a slow first call, and that a *persistent* timeout still
// surfaces the typed error rather than hanging.
//
// The module-level transport circuit is reset before each test so a prior
// describe's induced failures can't bleed in.
// ---------------------------------------------------------------------------

describe("chaos — slow first call recovery (#887)", () => {
  beforeEach(() => {
    __resetTransportCircuitsForTest();
  });

  it("read-only task_get recovers when the first call times out then succeeds", async () => {
    // First spawn: cold-start timeout. Second spawn (the retry): fast success.
    const spawner = sequencedSpawner(
      TIMEOUT_RESULT,
      okResult(JSON.stringify({ task: { id: "task_warm", name: "warmed up" } })),
    );
    // delayMs default is 100ms; keep the transport's own timeout tight so a
    // genuine hang would fail fast rather than stalling the test budget.
    const transport = new JxaTransport({ spawner, timeoutMs: 100 });

    const task = await transport.getTask("task_warm" as TaskId);

    // The retry swallowed the cold-start timeout — the caller sees success.
    expect(task.id).toBe("task_warm");
    expect(task.name).toBe("warmed up");
  });

  it("a persistent timeout (both attempts) surfaces a typed Timeout, not a hang", async () => {
    // Every spawn times out — the retry can't save it. The transport must
    // surface the typed error so the circuit breaker and caller can react.
    const spawner = sequencedSpawner(TIMEOUT_RESULT);
    const transport = new JxaTransport({ spawner, timeoutMs: 100 });

    const err = await transport.getTask("task_cold" as TaskId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Timeout);
    expect((err as Timeout).code).toBe("OF_TIMEOUT");
  });

  // The complementary invariant — writes never retry a transient failure —
  // is pinned at the runner level in
  // `src/adapter/jxa/scriptRunner.test.ts` ("does NOT retry a write-shaped
  // script even when the failure is transient"). Not re-asserted here: the
  // spawn-floor calibration call (#939) fires its own spawn on the first
  // transport call, so a call-count assertion at this layer is unreliable.
});
