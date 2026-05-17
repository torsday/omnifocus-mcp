/**
 * Tests for {@link TransportCircuit} — transport-level circuit breaker (#835).
 *
 * Covers: closed → open after N consecutive transient failures, open →
 * half-open after recoveryMs, half-open → closed on probe success, half-open
 * → open on probe failure, disabled bypass, permanent-failure exclusion,
 * and the success-resets-counter invariant.
 */

import { describe, expect, it, vi } from "vitest";
import {
  CircuitOpen,
  ConflictError,
  OmniFocusNotRunning,
  ScriptError,
  Timeout,
  ValidationError,
} from "../../errors/index.js";
import { isCircuitTransient, TransportCircuit } from "./transportCircuit.js";

function makeLogger() {
  return { warn: vi.fn(), info: vi.fn() };
}

function makeCircuit(overrides: Partial<ConstructorParameters<typeof TransportCircuit>[1]> = {}) {
  let clock = 0;
  const advance = (ms: number) => {
    clock += ms;
  };
  const logger = makeLogger();
  const circuit = new TransportCircuit("jxa", {
    threshold: 3,
    recoveryMs: 1000,
    enabled: true,
    logger,
    now: () => clock,
    ...overrides,
  });
  return {
    circuit,
    logger,
    advance,
    get clock() {
      return clock;
    },
  };
}

const transientErr = () => new Timeout("simulated");
const permanentErr = () => new ValidationError("simulated");

describe("isCircuitTransient", () => {
  it("treats Timeout as transient", () => {
    expect(isCircuitTransient(new Timeout("x"))).toBe(true);
  });
  it("treats OmniFocusNotRunning as transient", () => {
    expect(isCircuitTransient(new OmniFocusNotRunning())).toBe(true);
  });
  it("treats ValidationError as permanent", () => {
    expect(isCircuitTransient(new ValidationError("x"))).toBe(false);
  });
  it("treats ScriptError as permanent (logic bugs shouldn't trip the breaker)", () => {
    expect(isCircuitTransient(new ScriptError("x"))).toBe(false);
  });
  it("treats ConflictError as permanent", () => {
    expect(isCircuitTransient(new ConflictError("x"))).toBe(false);
  });
  it("treats arbitrary plain Error as permanent", () => {
    expect(isCircuitTransient(new Error("x"))).toBe(false);
  });
});

describe("TransportCircuit — happy path", () => {
  it("passes through results when closed", async () => {
    const { circuit } = makeCircuit();
    const out = await circuit.tryCall(async () => "ok", isCircuitTransient);
    expect(out).toBe("ok");
    expect(circuit.inspect().state).toBe("closed");
  });

  it("does not trip on permanent failures", async () => {
    const { circuit } = makeCircuit();
    for (let i = 0; i < 10; i++) {
      await expect(
        circuit.tryCall(async () => {
          throw permanentErr();
        }, isCircuitTransient),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(circuit.inspect().state).toBe("closed");
    expect(circuit.inspect().failureCount).toBe(0);
  });

  it("resets failure counter on a success between transients", async () => {
    const { circuit } = makeCircuit({ threshold: 3 });
    await expect(
      circuit.tryCall(async () => {
        throw transientErr();
      }, isCircuitTransient),
    ).rejects.toBeInstanceOf(Timeout);
    await expect(
      circuit.tryCall(async () => {
        throw transientErr();
      }, isCircuitTransient),
    ).rejects.toBeInstanceOf(Timeout);
    expect(circuit.inspect().failureCount).toBe(2);
    await circuit.tryCall(async () => "ok", isCircuitTransient);
    expect(circuit.inspect().failureCount).toBe(0);
    expect(circuit.inspect().state).toBe("closed");
  });
});

describe("TransportCircuit — trip + fail-fast", () => {
  it("opens after N consecutive transient failures and rejects with CircuitOpen", async () => {
    const { circuit, logger } = makeCircuit({ threshold: 3 });
    for (let i = 0; i < 3; i++) {
      await expect(
        circuit.tryCall(async () => {
          throw transientErr();
        }, isCircuitTransient),
      ).rejects.toBeInstanceOf(Timeout);
    }
    expect(circuit.inspect().state).toBe("open");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
      event: "transport.circuit.opened",
      transport: "jxa",
      reason: "3-consecutive-failures",
    });

    // Subsequent call short-circuits without invoking fn
    const fn = vi.fn(async () => "should-not-run");
    await expect(circuit.tryCall(fn, isCircuitTransient)).rejects.toBeInstanceOf(CircuitOpen);
    expect(fn).not.toHaveBeenCalled();
  });

  it("CircuitOpen details carry retryAfterMs and transport", async () => {
    const { circuit, advance } = makeCircuit({ threshold: 1, recoveryMs: 1000 });
    await expect(
      circuit.tryCall(async () => {
        throw transientErr();
      }, isCircuitTransient),
    ).rejects.toBeInstanceOf(Timeout);
    advance(200);
    try {
      await circuit.tryCall(async () => "x", isCircuitTransient);
      throw new Error("expected CircuitOpen");
    } catch (e) {
      expect(e).toBeInstanceOf(CircuitOpen);
      const details = (e as CircuitOpen).details as { transport: string; retryAfterMs: number };
      expect(details.transport).toBe("jxa");
      expect(details.retryAfterMs).toBe(800);
    }
  });
});

describe("TransportCircuit — half-open recovery", () => {
  it("half-opens after recoveryMs and closes on probe success", async () => {
    const { circuit, logger, advance } = makeCircuit({ threshold: 2, recoveryMs: 500 });
    await expect(
      circuit.tryCall(async () => {
        throw transientErr();
      }, isCircuitTransient),
    ).rejects.toBeInstanceOf(Timeout);
    await expect(
      circuit.tryCall(async () => {
        throw transientErr();
      }, isCircuitTransient),
    ).rejects.toBeInstanceOf(Timeout);
    expect(circuit.inspect().state).toBe("open");

    advance(500);
    const out = await circuit.tryCall(async () => "ok", isCircuitTransient);
    expect(out).toBe("ok");
    expect(circuit.inspect().state).toBe("closed");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "transport.circuit.closed", reason: "probe-succeeded" }),
      expect.any(String),
    );
  });

  it("re-opens (fresh timer) on probe failure", async () => {
    const { circuit, logger, advance } = makeCircuit({ threshold: 1, recoveryMs: 500 });
    await expect(
      circuit.tryCall(async () => {
        throw transientErr();
      }, isCircuitTransient),
    ).rejects.toBeInstanceOf(Timeout);
    expect(circuit.inspect().state).toBe("open");

    advance(500);
    // Probe — fails transiently → back to open
    await expect(
      circuit.tryCall(async () => {
        throw transientErr();
      }, isCircuitTransient),
    ).rejects.toBeInstanceOf(Timeout);
    expect(circuit.inspect().state).toBe("open");

    // Second "opened" event from the probe-failure transition
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls[1]?.[0]).toMatchObject({
      event: "transport.circuit.opened",
      reason: "probe-failed",
    });

    // Within the new recovery window, another call still fails fast
    advance(100);
    await expect(circuit.tryCall(async () => "x", isCircuitTransient)).rejects.toBeInstanceOf(
      CircuitOpen,
    );
  });
});

describe("TransportCircuit — disabled bypass", () => {
  it("passes everything through when enabled=false (no trip, no record)", async () => {
    const { circuit } = makeCircuit({ enabled: false, threshold: 1 });
    for (let i = 0; i < 5; i++) {
      await expect(
        circuit.tryCall(async () => {
          throw transientErr();
        }, isCircuitTransient),
      ).rejects.toBeInstanceOf(Timeout);
    }
    expect(circuit.inspect().state).toBe("closed");
    expect(circuit.inspect().failureCount).toBe(0);
  });
});

describe("TransportCircuit — 10-failure burst (acceptance test)", () => {
  it("10 transient failures open the breaker; subsequent calls fail fast", async () => {
    // Mirrors the acceptance criterion phrased in #835: synthetic burst
    // opens the breaker and subsequent calls short-circuit.
    const { circuit } = makeCircuit({ threshold: 5 });
    for (let i = 0; i < 10; i++) {
      const r = circuit.tryCall(async () => {
        throw transientErr();
      }, isCircuitTransient);
      if (i < 5) {
        await expect(r).rejects.toBeInstanceOf(Timeout);
      } else {
        await expect(r).rejects.toBeInstanceOf(CircuitOpen);
      }
    }
    expect(circuit.inspect().state).toBe("open");
  });
});
