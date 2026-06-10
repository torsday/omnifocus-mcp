/**
 * Tests for internal_status tool.
 *
 * Covers: schema validation, handler returns correct shape, graceful
 * degradation when getLastSync throws, circuits snapshot forwarded.
 */

import { describe, expect, it, vi } from "vitest";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleInternalStatus, internalStatusInputSchema } from "./internalStatus.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeMeta(partial: Partial<ResponseMeta> = {}): ResponseMeta {
  return {
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  };
}

function makeCtx(
  overrides: {
    getLastSync?: () => Promise<{ lastSyncAt: string | null; inFlight: boolean }>;
    snapshot?: () => Array<{ name: string; state: string }>;
    startedAt?: number;
    probeCalendarAccess?: () => Promise<{
      available: boolean;
      permission: "granted" | "denied" | "restricted" | "not-determined" | "unknown";
    }>;
    probeMutationScore?: () => { score: number; lastRunAt: string } | null;
    probeResponseStats?: () =>
      | import("../../observability/responseStats.js").ResponseStatsSnapshot
      | null;
    probeLatencyStats?: () =>
      | import("../../observability/latencyStats.js").LatencyStatsSnapshot
      | null;
    probeToolDurationStats?: () =>
      | import("../../observability/toolDurationStats.js").ToolDurationSnapshot
      | null;
    probeTransportStats?: () => import("../../observability/transportStats.js").PersistentTransportStats;
    probeQueueDepth?: () => number;
    probeOfRunning?: () => boolean | null;
  } = {},
) {
  const adapter = {
    getLastSync:
      overrides.getLastSync ??
      vi.fn().mockResolvedValue({ lastSyncAt: "2026-01-01T00:00:00Z", inFlight: false }),
  } as unknown as import("../../adapter/OmniFocusAdapter.js").OmniFocusAdapter;

  const circuitRegistry = {
    snapshot:
      overrides.snapshot ?? vi.fn().mockReturnValue([{ name: "task_list", state: "closed" }]),
  };

  const ctx: import("./internalStatus.js").InternalStatusContext = {
    startedAt: overrides.startedAt ?? Date.now() - 5000,
    adapter,
    circuitRegistry,
    makeMeta,
    // Default to a degraded-friendly stub so tests don't spawn the Swift
    // bridge (and aren't sensitive to whether the binary is built).
    probeCalendarAccess:
      overrides.probeCalendarAccess ??
      vi.fn().mockResolvedValue({ available: false, permission: "unknown" as const }),
    // Default to "no report present" so tests don't depend on the live
    // reports/mutation/mutation.json file from the calibration run.
    probeMutationScore: overrides.probeMutationScore ?? vi.fn().mockReturnValue(null),
  };
  // Only set probeResponseStats when explicitly provided — exactOptionalPropertyTypes
  // distinguishes "key absent" (telemetry off) from "key present with undefined".
  if (overrides.probeResponseStats !== undefined) {
    ctx.probeResponseStats = overrides.probeResponseStats;
  }
  if (overrides.probeLatencyStats !== undefined) {
    ctx.probeLatencyStats = overrides.probeLatencyStats;
  }
  if (overrides.probeToolDurationStats !== undefined) {
    ctx.probeToolDurationStats = overrides.probeToolDurationStats;
  }
  if (overrides.probeTransportStats !== undefined) {
    ctx.probeTransportStats = overrides.probeTransportStats;
  }
  if (overrides.probeQueueDepth !== undefined) {
    ctx.probeQueueDepth = overrides.probeQueueDepth;
  }
  if (overrides.probeOfRunning !== undefined) {
    ctx.probeOfRunning = overrides.probeOfRunning;
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("internal_status — input schema", () => {
  it("accepts an empty object", () => {
    expect(internalStatusInputSchema.parse({})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Handler — happy path
// ---------------------------------------------------------------------------

describe("internal_status — handler", () => {
  it("returns uptimeMs as a positive number", async () => {
    const ctx = makeCtx({ startedAt: Date.now() - 5000 });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.uptimeMs).toBeGreaterThan(0);
  });

  it("returns ofRunning=null when no liveness probe is wired (never a fabricated true)", async () => {
    const ctx = makeCtx();
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.ofRunning).toBeNull();
  });

  it("forwards the liveness probe result when wired", async () => {
    const ctx = makeCtx({ probeOfRunning: () => false });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.ofRunning).toBe(false);
  });

  it("surfaces ofRunning=null when the liveness probe throws", async () => {
    const ctx = makeCtx({
      probeOfRunning: () => {
        throw new Error("probe boom");
      },
    });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.ofRunning).toBeNull();
  });

  it("reports the negotiated session density (#818)", async () => {
    const ctx = makeCtx();
    // No negotiation in this test process → the default profile.
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.density).toBe("default");
  });

  it("returns lastSync from adapter.getLastSync", async () => {
    const ctx = makeCtx({
      getLastSync: vi
        .fn()
        .mockResolvedValue({ lastSyncAt: "2026-01-01T00:00:00Z", inFlight: false }),
    });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.lastSync).toEqual({
      lastSyncAt: "2026-01-01T00:00:00Z",
      inFlight: false,
    });
  });

  it("returns circuits from circuitRegistry.snapshot", async () => {
    const ctx = makeCtx({
      snapshot: vi.fn().mockReturnValue([{ name: "task_list", state: "closed" }]),
    });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.circuits).toEqual([{ name: "task_list", state: "closed" }]);
  });

  it("returns cache=null and queueDepth=null when no probes are wired", async () => {
    const ctx = makeCtx();
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.cache).toBeNull();
    expect(envelope.data.queueDepth).toBeNull();
  });

  it("returns queueDepth from probeQueueDepth when wired (#1108)", async () => {
    const ctx = makeCtx({ probeQueueDepth: () => 4 });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.queueDepth).toBe(4);
  });

  it("surfaces queueDepth=null when the probe throws (#1108)", async () => {
    const ctx = makeCtx({
      probeQueueDepth: () => {
        throw new Error("probe boom");
      },
    });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.queueDepth).toBeNull();
  });

  it("wraps response in ok() envelope with provided meta", async () => {
    const ctx = makeCtx();
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.meta.correlationId).toBe("test-cid");
    expect("data" in envelope).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Handler — error resilience
// ---------------------------------------------------------------------------

describe("internal_status — error resilience", () => {
  it("returns lastSync=null when getLastSync throws", async () => {
    const ctx = makeCtx({
      getLastSync: vi.fn().mockRejectedValue(new Error("OF not running")),
    });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.lastSync).toBeNull();
  });

  it("still returns a valid envelope when getLastSync throws", async () => {
    const ctx = makeCtx({
      getLastSync: vi.fn().mockRejectedValue(new Error("OF not running")),
    });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.uptimeMs).toBeGreaterThanOrEqual(0);
    // Previously pinned ofRunning=true here — asserting the misleading value
    // in exactly the failure scenario the field exists to report. With no
    // liveness probe wired the honest answer is null ("not probed").
    expect(envelope.data.ofRunning).toBeNull();
    expect(Array.isArray(envelope.data.circuits)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Handler — calendarAccess
// ---------------------------------------------------------------------------

describe("internal_status — calendarAccess", () => {
  it("forwards the probe result verbatim when the bridge is available", async () => {
    const ctx = makeCtx({
      probeCalendarAccess: vi.fn().mockResolvedValue({ available: true, permission: "granted" }),
    });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.calendarAccess).toEqual({ available: true, permission: "granted" });
  });

  it("returns the degraded shape when the bridge binary is missing", async () => {
    const ctx = makeCtx({
      probeCalendarAccess: vi.fn().mockResolvedValue({ available: false, permission: "unknown" }),
    });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.calendarAccess).toEqual({ available: false, permission: "unknown" });
  });

  it("surfaces null when the probe throws unexpectedly", async () => {
    const ctx = makeCtx({
      probeCalendarAccess: vi.fn().mockRejectedValue(new Error("unexpected")),
    });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.calendarAccess).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Handler — mutation
// ---------------------------------------------------------------------------

describe("internal_status — mutation", () => {
  it("forwards the probe result verbatim when a mutation report is present", async () => {
    const snapshot = { score: 62.74, lastRunAt: "2026-04-29T14:09:28.000Z" };
    const ctx = makeCtx({ probeMutationScore: vi.fn().mockReturnValue(snapshot) });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.mutation).toEqual(snapshot);
  });

  it("returns null when no mutation report is present", async () => {
    const ctx = makeCtx({ probeMutationScore: vi.fn().mockReturnValue(null) });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.mutation).toBeNull();
  });

  it("surfaces null when the probe throws unexpectedly", async () => {
    const ctx = makeCtx({
      probeMutationScore: vi.fn().mockImplementation(() => {
        throw new Error("unexpected");
      }),
    });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.mutation).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Handler — responseStats (#778)
// ---------------------------------------------------------------------------

describe("internal_status — responseStats", () => {
  it("returns null when no probe is provided (telemetry off)", async () => {
    const ctx = makeCtx();
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.responseStats).toBeNull();
  });

  it("forwards the probe result verbatim when telemetry is on", async () => {
    const snapshot = {
      since: "2026-05-09T00:00:00.000Z",
      sampleRate: 1,
      thresholdBytes: 51200,
      tools: {
        task_list: { count: 10, total: 5000, max: 800, p50: 500, p95: 780 },
      },
    };
    const ctx = makeCtx({ probeResponseStats: vi.fn().mockReturnValue(snapshot) });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.responseStats).toEqual(snapshot);
  });

  it("surfaces null when the probe throws unexpectedly", async () => {
    const ctx = makeCtx({
      probeResponseStats: vi.fn().mockImplementation(() => {
        throw new Error("registry exploded");
      }),
    });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.responseStats).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Handler — latencyStats (#940)
// ---------------------------------------------------------------------------

describe("internal_status — toolDurationStats", () => {
  it("returns null when no probe is provided (telemetry off)", async () => {
    const ctx = makeCtx();
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.toolDurationStats).toBeNull();
  });

  it("forwards the probe result verbatim when telemetry is on", async () => {
    const snapshot = {
      since: "2026-05-17T00:00:00.000Z",
      sampleRate: 1,
      thresholdMs: 5000,
      tools: {
        task_list: { count: 12, max: 1500, p50: 80, p95: 1200 },
      },
    };
    const ctx = makeCtx({ probeToolDurationStats: vi.fn().mockReturnValue(snapshot) });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.toolDurationStats).toEqual(snapshot);
  });

  it("surfaces null when the probe throws unexpectedly", async () => {
    const ctx = makeCtx({
      probeToolDurationStats: vi.fn().mockImplementation(() => {
        throw new Error("registry exploded");
      }),
    });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.toolDurationStats).toBeNull();
  });
});

describe("internal_status — latencyStats", () => {
  it("returns null when no probe is provided (telemetry off)", async () => {
    const ctx = makeCtx();
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.latencyStats).toBeNull();
  });

  it("forwards the probe result verbatim when telemetry is on", async () => {
    const snapshot = {
      since: "2026-05-17T00:00:00.000Z",
      sampleRate: 1,
      thresholdMs: 2000,
      transports: {
        jxa: {
          spawnFloorMs: 180,
          scripts: {
            task_get: { count: 12, max: 1500, p50: 80, p95: 1200 },
          },
        },
        omnijs: { spawnFloorMs: 0, scripts: {} },
      },
    };
    const ctx = makeCtx({ probeLatencyStats: vi.fn().mockReturnValue(snapshot) });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.latencyStats).toEqual(snapshot);
  });

  it("surfaces null when the probe throws unexpectedly", async () => {
    const ctx = makeCtx({
      probeLatencyStats: vi.fn().mockImplementation(() => {
        throw new Error("registry exploded");
      }),
    });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.latencyStats).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// probeCache — per-service cache stats (#821)
// ---------------------------------------------------------------------------

describe("handleInternalStatus — probeCache", () => {
  it("returns cache=null when no probeCache is provided", async () => {
    const ctx = makeCtx();
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.cache).toBeNull();
  });

  it("surfaces cache stats from probeCache", async () => {
    const ctx = {
      ...makeCtx(),
      probeCache: () => ({
        size: 3,
        hits: 10,
        misses: 2,
        evictions: 0,
        coalesced: 1,
        bytes: 4096,
        maxBytes: 16_777_216,
        services: {
          tag: { hits: 5, misses: 1, hitRate: 5 / 6 },
          task: { hits: 5, misses: 1, hitRate: 5 / 6 },
        },
      }),
    };
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.cache?.size).toBe(3);
    expect(envelope.data.cache?.services.tag).toMatchObject({ hits: 5, misses: 1 });
  });

  it("degrades to cache=null when probeCache throws", async () => {
    const ctx = {
      ...makeCtx(),
      probeCache: () => {
        throw new Error("probe failed");
      },
    };
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.cache).toBeNull();
  });
});

describe("internal_status — transport (persistent JXA, #882)", () => {
  it("is null when the probe is not wired", async () => {
    const envelope = await handleInternalStatus({}, makeCtx());
    expect(envelope.data.transport).toBeNull();
  });

  it("forwards the persistent-transport stats snapshot", async () => {
    const snapshot = {
      enabled: true,
      alive: true,
      spawns: 2,
      unexpectedExits: 1,
      restarts: 1,
      timeouts: 0,
      callsServed: 17,
    };
    const ctx = makeCtx({ probeTransportStats: () => snapshot });
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.transport).toEqual(snapshot);
  });

  it("degrades to transport=null when the probe throws", async () => {
    const ctx = {
      ...makeCtx(),
      probeTransportStats: () => {
        throw new Error("probe failed");
      },
    };
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.transport).toBeNull();
  });
});
