/**
 * Unit tests for CircuitBreaker and CircuitBreakerRegistry.
 *
 * Uses an injected clock (`now` option) so every timing assertion is
 * deterministic — no real timers, no `setTimeout`, no flakiness.
 *
 * @see src/server/circuitBreaker.ts
 * @see DESIGN.md §6.10 — circuit breaker specification
 */

import { describe, expect, it, vi } from "vitest";
import { CircuitOpen, NotFound, RateLimited, Timeout, ValidationError } from "../errors/index.js";
import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  isCircuitCountableFailure,
} from "./circuitBreaker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Controllable fake clock. */
function makeClock(initial = 0) {
  let t = initial;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** A breaker with tight thresholds for fast tests. */
function makeBreaker(clock = makeClock(), overrides: { failureThreshold?: number } = {}) {
  return new CircuitBreaker("test_tool", {
    failureThreshold: overrides.failureThreshold ?? 3,
    windowMs: 60_000,
    openDurationMs: 60_000,
    now: clock.now,
  });
}

const ok = () => Promise.resolve("ok");
const fail = () => Promise.reject(new Error("boom"));

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("CircuitBreaker — initial state", () => {
  it("starts in CLOSED state", () => {
    expect(makeBreaker().state).toBe("closed");
  });

  it("passes through successful calls unchanged", async () => {
    const b = makeBreaker();
    const result = await b.call(ok);
    expect(result).toBe("ok");
    expect(b.state).toBe("closed");
  });
});

// ---------------------------------------------------------------------------
// Failure counting
// ---------------------------------------------------------------------------

describe("CircuitBreaker — failure counting", () => {
  it("stays CLOSED below the failure threshold", async () => {
    const b = makeBreaker();
    await expect(b.call(fail)).rejects.toThrow("boom");
    await expect(b.call(fail)).rejects.toThrow("boom");
    expect(b.state).toBe("closed"); // 2 failures, threshold is 3
  });

  it("opens after hitting the failure threshold", async () => {
    const b = makeBreaker();
    await expect(b.call(fail)).rejects.toThrow();
    await expect(b.call(fail)).rejects.toThrow();
    await expect(b.call(fail)).rejects.toThrow();
    expect(b.state).toBe("open");
  });

  it("success resets the failure count", async () => {
    const b = makeBreaker();
    await expect(b.call(fail)).rejects.toThrow();
    await expect(b.call(fail)).rejects.toThrow();
    await b.call(ok); // resets failures
    await expect(b.call(fail)).rejects.toThrow();
    await expect(b.call(fail)).rejects.toThrow();
    expect(b.state).toBe("closed"); // only 2 failures since last success
  });

  it("prunes failures outside the rolling window", async () => {
    const clock = makeClock();
    const b = makeBreaker(clock);
    await expect(b.call(fail)).rejects.toThrow(); // t=0
    await expect(b.call(fail)).rejects.toThrow(); // t=0
    clock.advance(61_000); // past windowMs
    await expect(b.call(fail)).rejects.toThrow(); // t=61000 — old failures pruned
    await expect(b.call(fail)).rejects.toThrow(); // t=61000 — 2nd fresh failure
    expect(b.state).toBe("closed"); // only 2 in-window failures
  });
});

// ---------------------------------------------------------------------------
// Failure classification (C26) — input/backpressure errors don't count
// ---------------------------------------------------------------------------

describe("CircuitBreaker — failure classification", () => {
  const notFound = () => Promise.reject(new NotFound("Task not found: stale-id"));
  const rateLimited = () => Promise.reject(new RateLimited("window full"));
  const timeout = () => Promise.reject(new Timeout("JXA script exceeded 30000ms timeout"));

  it("stays CLOSED after repeated input-class errors (stale-id NotFound probes)", async () => {
    const b = makeBreaker();
    for (let i = 0; i < 5; i++) await expect(b.call(notFound)).rejects.toThrow();
    expect(b.state).toBe("closed");
    // A healthy call must still reach the handler — no OF_CIRCUIT_OPEN.
    await expect(b.call(ok)).resolves.toBe("ok");
  });

  it("stays CLOSED after repeated backpressure errors (RateLimited)", async () => {
    const b = makeBreaker();
    for (let i = 0; i < 5; i++) await expect(b.call(rateLimited)).rejects.toThrow();
    expect(b.state).toBe("closed");
  });

  it("still opens on taxonomy errors that signal a sick pipeline (Timeout)", async () => {
    const b = makeBreaker();
    for (let i = 0; i < 3; i++) await expect(b.call(timeout)).rejects.toThrow();
    expect(b.state).toBe("open");
  });

  it("a non-countable error mid-burst neither counts nor resets the window", async () => {
    const b = makeBreaker();
    await expect(b.call(timeout)).rejects.toThrow();
    await expect(b.call(timeout)).rejects.toThrow();
    await expect(b.call(notFound)).rejects.toThrow(); // not counted, not a reset
    expect(b.state).toBe("closed");
    await expect(b.call(timeout)).rejects.toThrow(); // 3rd countable failure
    expect(b.state).toBe("open");
  });

  it("a half-open probe hitting a non-countable error neither closes nor re-opens", async () => {
    const clock = makeClock();
    const b = makeBreaker(clock);
    for (let i = 0; i < 3; i++) await expect(b.call(fail)).rejects.toThrow();
    clock.advance(60_000);
    expect(b.state).toBe("half_open");
    await expect(b.call(notFound)).rejects.toThrow();
    // Inconclusive probe — the slot frees up for the next caller.
    expect(b.state).toBe("half_open");
    await b.call(ok);
    expect(b.state).toBe("closed");
  });

  it("isCircuitCountableFailure classifies by error code, not message", () => {
    expect(isCircuitCountableFailure(new ValidationError("bad input"))).toBe(false);
    expect(isCircuitCountableFailure(new NotFound("nope"))).toBe(false);
    expect(isCircuitCountableFailure(new RateLimited("slow down"))).toBe(false);
    expect(isCircuitCountableFailure(new CircuitOpen("already open"))).toBe(false);
    expect(isCircuitCountableFailure(new Timeout("wedged"))).toBe(true);
    expect(isCircuitCountableFailure(new Error("unknown crash"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OPEN state — fast-fail
// ---------------------------------------------------------------------------

describe("CircuitBreaker — OPEN state", () => {
  async function openBreaker() {
    const clock = makeClock();
    const b = makeBreaker(clock);
    for (let i = 0; i < 3; i++) await expect(b.call(fail)).rejects.toThrow();
    return { b, clock };
  }

  it("throws CircuitOpen without calling fn", async () => {
    const { b } = await openBreaker();
    const fn = vi.fn(ok);
    await expect(b.call(fn)).rejects.toBeInstanceOf(CircuitOpen);
    expect(fn).not.toHaveBeenCalled();
  });

  it("CircuitOpen has code OF_CIRCUIT_OPEN", async () => {
    const { b } = await openBreaker();
    try {
      await b.call(ok);
    } catch (e) {
      expect(e).toBeInstanceOf(CircuitOpen);
      expect((e as CircuitOpen).code).toBe("OF_CIRCUIT_OPEN");
    }
  });

  it("includes retryAfterMs in details", async () => {
    const { b } = await openBreaker();
    try {
      await b.call(ok);
    } catch (e) {
      const err = e as CircuitOpen;
      expect(typeof err.details?.retryAfterMs).toBe("number");
      expect((err.details?.retryAfterMs as number) ?? 0).toBeGreaterThan(0);
    }
  });

  it("stays OPEN before openDurationMs elapses", async () => {
    const { b, clock } = await openBreaker();
    clock.advance(59_999);
    expect(b.state).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// HALF_OPEN state — probe logic
// ---------------------------------------------------------------------------

describe("CircuitBreaker — HALF_OPEN state", () => {
  async function halfOpenBreaker() {
    const clock = makeClock();
    const b = makeBreaker(clock);
    for (let i = 0; i < 3; i++) await expect(b.call(fail)).rejects.toThrow();
    clock.advance(60_000); // openDurationMs elapsed → half-open
    return { b, clock };
  }

  it("transitions to HALF_OPEN after openDurationMs", async () => {
    const { b } = await halfOpenBreaker();
    expect(b.state).toBe("half_open");
  });

  it("closes on successful probe", async () => {
    const { b } = await halfOpenBreaker();
    await b.call(ok);
    expect(b.state).toBe("closed");
  });

  it("re-opens on failed probe", async () => {
    const { b } = await halfOpenBreaker();
    await expect(b.call(fail)).rejects.toThrow();
    expect(b.state).toBe("open");
  });

  it("fast-fails concurrent callers while probe is in flight", async () => {
    const { b } = await halfOpenBreaker();
    // Start a slow probe that hasn't resolved yet
    let resolveProbe!: () => void;
    const slowProbe = new Promise<string>((resolve) => {
      resolveProbe = () => resolve("ok");
    });
    const probeCall = b.call(() => slowProbe);
    // Second caller should fast-fail
    await expect(b.call(ok)).rejects.toBeInstanceOf(CircuitOpen);
    resolveProbe();
    await probeCall;
    expect(b.state).toBe("closed");
  });
});

// ---------------------------------------------------------------------------
// CircuitBreakerRegistry
// ---------------------------------------------------------------------------

describe("CircuitBreakerRegistry", () => {
  it("returns a CircuitBreaker for a given tool name", () => {
    const reg = new CircuitBreakerRegistry();
    const b = reg.get("task_list");
    expect(b).toBeInstanceOf(CircuitBreaker);
  });

  it("returns the same instance on repeated calls", () => {
    const reg = new CircuitBreakerRegistry();
    expect(reg.get("task_list")).toBe(reg.get("task_list"));
  });

  it("returns distinct instances for different tool names", () => {
    const reg = new CircuitBreakerRegistry();
    expect(reg.get("task_list")).not.toBe(reg.get("project_list"));
  });

  it("tracks the number of registered breakers", () => {
    const reg = new CircuitBreakerRegistry();
    reg.get("a");
    reg.get("b");
    expect(reg.size).toBe(2);
  });

  it("clear() removes all breakers", () => {
    const reg = new CircuitBreakerRegistry();
    reg.get("a");
    reg.clear();
    expect(reg.size).toBe(0);
  });

  it("propagates default options to created breakers", async () => {
    const clock = makeClock();
    const reg = new CircuitBreakerRegistry({ failureThreshold: 1, now: clock.now });
    const b = reg.get("fast_fail");
    await expect(b.call(fail)).rejects.toThrow();
    expect(b.state).toBe("open"); // threshold 1 → open after single failure
  });
});
