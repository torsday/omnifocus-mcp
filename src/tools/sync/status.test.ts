/**
 * Tests for sync_status tool.
 *
 * Covers: schema validation, handler returns lastSyncAt + inFlight,
 * read-only (no side effects on adapter state).
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleSyncStatus, syncStatusInputSchema } from "./status.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx() {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { adapter, makeMeta };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("sync_status — input schema", () => {
  it("accepts an empty object", () => {
    expect(syncStatusInputSchema.parse({})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("sync_status — handler", () => {
  it("returns envelope with lastSyncAt and inFlight", async () => {
    const { adapter, makeMeta } = makeCtx();
    const envelope = await handleSyncStatus({}, { adapter, makeMeta });
    expect("lastSyncAt" in envelope.data).toBe(true);
    expect("inFlight" in envelope.data).toBe(true);
  });

  it("returns inFlight=false when no sync is running", async () => {
    const { adapter, makeMeta } = makeCtx();
    const envelope = await handleSyncStatus({}, { adapter, makeMeta });
    expect(envelope.data.inFlight).toBe(false);
  });

  it("returns lastSyncAt=null before any sync has run", async () => {
    const { adapter, makeMeta } = makeCtx();
    const envelope = await handleSyncStatus({}, { adapter, makeMeta });
    // InMemoryAdapter initializes lastSyncAt to null until syncTrigger is called
    expect(envelope.data.lastSyncAt).toBeNull();
  });

  it("returns lastSyncAt as ISO string after a sync has run", async () => {
    const { adapter, makeMeta } = makeCtx();
    // Trigger a sync first to set lastSyncAt
    await adapter.syncTrigger();
    const envelope = await handleSyncStatus({}, { adapter, makeMeta });
    expect(typeof envelope.data.lastSyncAt).toBe("string");
  });

  it("does not mutate adapter state (read-only)", async () => {
    const { adapter, makeMeta } = makeCtx();
    const before = await adapter.getLastSync();
    await handleSyncStatus({}, { adapter, makeMeta });
    const after = await adapter.getLastSync();
    expect(after.lastSyncAt).toBe(before.lastSyncAt);
    expect(after.inFlight).toBe(before.inFlight);
  });
});
