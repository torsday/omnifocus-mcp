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

function makeCtx(overrides: {
  getLastSync?: () => Promise<{ lastSyncAt: string | null; inFlight: boolean }>;
  snapshot?: () => Array<{ name: string; state: string }>;
  startedAt?: number;
} = {}) {
  const adapter = {
    getLastSync:
      overrides.getLastSync ??
      vi.fn().mockResolvedValue({ lastSyncAt: "2026-01-01T00:00:00Z", inFlight: false }),
  } as unknown as import("../../adapter/OmniFocusAdapter.js").OmniFocusAdapter;

  const circuitRegistry = {
    snapshot: overrides.snapshot ?? vi.fn().mockReturnValue([{ name: "task_list", state: "closed" }]),
  };

  return {
    startedAt: overrides.startedAt ?? Date.now() - 5000,
    adapter,
    circuitRegistry,
    makeMeta,
  };
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

  it("returns ofRunning=true", async () => {
    const ctx = makeCtx();
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.ofRunning).toBe(true);
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

  it("returns cache=null and queueDepth=null (not yet tracked)", async () => {
    const ctx = makeCtx();
    const envelope = await handleInternalStatus({}, ctx);
    expect(envelope.data.cache).toBeNull();
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
    expect(envelope.data.ofRunning).toBe(true);
    expect(Array.isArray(envelope.data.circuits)).toBe(true);
  });
});
