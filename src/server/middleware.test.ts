/**
 * Tests for {@link composeToolCallback} — the per-tool middleware stack
 * (#291). Goldilocks coverage: one path per protective layer, plus the happy
 * path that proves composition order works end to end. Heavy state-machine
 * branches live in each middleware's own unit test (see
 * `src/rateLimit/withRateLimitMeta.test.ts`, `src/loopDetector/...`,
 * `src/server/circuitBreaker.test.ts`); we don't restate them here.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import type { ToolSuccess } from "../envelope/index.js";
import { LoopDetector } from "../loopDetector/LoopDetector.js";
import { ResponseStatsRegistry } from "../observability/responseStats.js";
import { ToolRateLimiter } from "../rateLimit/ToolRateLimiter.js";
import { CircuitBreakerRegistry } from "./circuitBreaker.js";
import { composeToolCallback } from "./middleware.js";
import { ShutdownController } from "./shutdown.js";

function makeDeps(
  overrides: {
    rateLimit?: { limit: number; windowSeconds: number };
    responseStats?: ResponseStatsRegistry;
  } = {},
): import("./middleware.js").ToolMiddlewareDeps {
  const deps: import("./middleware.js").ToolMiddlewareDeps = {
    rateLimiter: new ToolRateLimiter(overrides.rateLimit ?? { limit: 120, windowSeconds: 60 }),
    loopDetector: new LoopDetector({ threshold: 5, windowSeconds: 60 }),
    circuitRegistry: new CircuitBreakerRegistry(),
    shutdown: new ShutdownController(),
  };
  if (overrides.responseStats !== undefined) {
    deps.responseStats = overrides.responseStats;
  }
  return deps;
}

/** Build a fake SDK callback that returns a fixed envelope wrapped per `toolResponse`. */
function makeOkCallback(): (args: unknown, extra: unknown) => Promise<CallToolResult> {
  return async () => {
    const envelope: ToolSuccess<{ value: number }> = {
      data: { value: 1 },
      meta: {
        correlationId: "01J0000000000000000000TEST",
        durationMs: 0,
        cacheHit: false,
        transport: "memory",
        ofVersion: "unknown",
      },
    };
    return {
      content: [{ type: "text", text: JSON.stringify(envelope) }],
      structuredContent: envelope as unknown as Record<string, unknown>,
    };
  };
}

describe("composeToolCallback", () => {
  it("threads success through the stack and injects rateLimit meta", async () => {
    const deps = makeDeps();
    const wrapped = composeToolCallback("tool_a", makeOkCallback(), deps);

    const result = await wrapped({ x: 1 }, {});
    const env = result.structuredContent as unknown as ToolSuccess<{ value: number }>;
    expect(env.data.value).toBe(1);
    expect(env.meta.rateLimit?.remaining).toBe(119); // 120 - this call
    expect(env.meta.warnings ?? []).toHaveLength(0);
  });

  it("appends WARN_LOOP_DETECTED once the threshold is crossed", async () => {
    const deps = makeDeps();
    const wrapped = composeToolCallback("tool_b", makeOkCallback(), deps);

    // Five identical calls — the 5th crosses the loop-detector threshold.
    let last: CallToolResult | undefined;
    for (let i = 0; i < 5; i++) {
      last = await wrapped({ same: "args" }, {});
    }
    const env = last?.structuredContent as unknown as ToolSuccess<unknown>;
    const warnings = env.meta.warnings ?? [];
    expect(warnings.some((w) => w.code === "WARN_LOOP_DETECTED")).toBe(true);
  });

  it("throws RateLimited when the per-tool window is full", async () => {
    const deps = makeDeps({ rateLimit: { limit: 2, windowSeconds: 60 } });
    const wrapped = composeToolCallback("tool_c", makeOkCallback(), deps);

    await wrapped({ i: 1 }, {});
    await wrapped({ i: 2 }, {});
    await expect(wrapped({ i: 3 }, {})).rejects.toMatchObject({ code: "OF_RATE_LIMITED" });
  });

  it("opens the circuit after consecutive failures and fast-fails", async () => {
    const deps = makeDeps();
    const failingCb = async (): Promise<CallToolResult> => {
      throw new Error("boom");
    };
    const wrapped = composeToolCallback("tool_d", failingCb, deps);

    // Default failureThreshold is 3 — three failures must open the circuit.
    for (let i = 0; i < 3; i++) {
      await expect(wrapped({}, {})).rejects.toThrow();
    }
    // Next call must short-circuit with CircuitOpen rather than re-invoke.
    await expect(wrapped({}, {})).rejects.toMatchObject({ code: "OF_CIRCUIT_OPEN" });
  });

  it("records the full SDK-result wire size into responseStats on success (#778, corrected #793)", async () => {
    const responseStats = new ResponseStatsRegistry({
      sampleRate: 1,
      thresholdBytes: Infinity,
      logger: { warn: vi.fn(), info: vi.fn() } as unknown as ConstructorParameters<
        typeof ResponseStatsRegistry
      >[0]["logger"],
    });
    const deps = makeDeps({ responseStats });
    const wrapped = composeToolCallback("tool_stats", makeOkCallback(), deps);

    const result = await wrapped({}, {});
    await wrapped({}, {});
    await wrapped({}, {});

    const snap = responseStats.snapshot();
    expect(snap.tools.tool_stats?.count).toBe(3);

    // Measurement covers the full SDK result (`content[].text` + `structuredContent`),
    // not just `structuredContent`. Per ADR-0022, both ship on the wire, so the
    // recorded `max` must be at least the size of `JSON.stringify(structuredContent)` +
    // the length of the duplicated text payload — i.e. close to ~2× the typed half.
    const structuredBytes = Buffer.byteLength(JSON.stringify(result.structuredContent), "utf-8");
    expect(snap.tools.tool_stats?.max).toBeGreaterThanOrEqual(structuredBytes * 2);
  });

  it("does not record into responseStats on a thrown handler error", async () => {
    const responseStats = new ResponseStatsRegistry({
      sampleRate: 1,
      thresholdBytes: Infinity,
      logger: { warn: vi.fn(), info: vi.fn() } as unknown as ConstructorParameters<
        typeof ResponseStatsRegistry
      >[0]["logger"],
    });
    const deps = makeDeps({ responseStats });
    const failingCb = async (): Promise<CallToolResult> => {
      throw new Error("boom");
    };
    const wrapped = composeToolCallback("tool_fail", failingCb, deps);

    await expect(wrapped({}, {})).rejects.toThrow();
    expect(responseStats.snapshot().tools.tool_fail).toBeUndefined();
  });

  it("rejects with ServerShuttingDown once the controller flips", async () => {
    const deps = makeDeps();
    const wrapped = composeToolCallback("tool_e", makeOkCallback(), deps);

    // First call goes through.
    await wrapped({}, {});

    // Flip the flag directly — initiate() would call process.exit; we only
    // need `isShuttingDown=true` to exercise assertNotShuttingDown.
    (deps.shutdown as unknown as { _shuttingDown: boolean })._shuttingDown = true;

    await expect(wrapped({}, {})).rejects.toMatchObject({ code: "OF_SHUTTING_DOWN" });
  });
});
