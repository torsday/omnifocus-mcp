/**
 * Tests for sync_trigger tool and the meta.syncPending lifecycle.
 *
 * Covers: schema validation, handler returns lastSyncAt + syncPending=false,
 * write tools set syncPending=true, and the full lifecycle:
 *   write → syncPending=true → sync_trigger → syncPending=false.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { TagService } from "../../services/tagService.js";
import { handleTagCreate } from "../tag/create.js";
import { handleSyncTrigger, syncTriggerInputSchema } from "./trigger.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx() {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const tagService = new TagService({ adapter });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { adapter, tagService, makeMeta };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("sync_trigger — input schema", () => {
  it("accepts an empty object", () => {
    expect(syncTriggerInputSchema.parse({})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("sync_trigger — handler", () => {
  it("returns lastSyncAt and inFlight=false", async () => {
    const { adapter, makeMeta } = makeCtx();
    const envelope = await handleSyncTrigger({}, { adapter, makeMeta });
    expect(envelope.data.inFlight).toBe(false);
    expect(typeof envelope.data.lastSyncAt).toBe("string");
  });

  it("returns meta.syncPending = false", async () => {
    const { adapter, makeMeta } = makeCtx();
    const envelope = await handleSyncTrigger({}, { adapter, makeMeta });
    expect(envelope.meta.syncPending).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncPending lifecycle
// ---------------------------------------------------------------------------

describe("meta.syncPending lifecycle", () => {
  it("write tool sets meta.syncPending = true", async () => {
    const { tagService, makeMeta } = makeCtx();
    const envelope = await handleTagCreate({ name: "Work" }, { tagService, makeMeta });
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("read (non-mutation) does not set syncPending", async () => {
    const { adapter, makeMeta } = makeCtx();
    const envelope = await handleSyncTrigger({}, { adapter, makeMeta });
    // After sync, syncPending is explicitly false — not absent
    expect(envelope.meta.syncPending).toBe(false);
  });

  it("write → pending=true; sync_trigger → pending=false", async () => {
    const { adapter, tagService, makeMeta } = makeCtx();

    // 1. Perform a write — should have syncPending=true
    const writeEnvelope = await handleTagCreate({ name: "Work" }, { tagService, makeMeta });
    expect(writeEnvelope.meta.syncPending).toBe(true);

    // 2. Trigger sync — should report syncPending=false
    const syncEnvelope = await handleSyncTrigger({}, { adapter, makeMeta });
    expect(syncEnvelope.meta.syncPending).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation (docs/cache-invalidation.md) — sync_trigger clears all
// ---------------------------------------------------------------------------

describe("sync_trigger — cache invalidation", () => {
  it("clears every cached read after the sync kicks off", async () => {
    const { adapter, makeMeta } = makeCtx();
    const cache = new OmniFocusLruCache();
    // Seed a few entries across multiple scopes.
    cache.set("task:t1:detail", { ok: 1 });
    cache.set("project:p1:list", { ok: 2 });
    cache.set("forecast:today", { ok: 3 });
    expect(cache.stats().size).toBe(3);

    await handleSyncTrigger({}, { adapter, makeMeta, cache });

    expect(cache.stats().size).toBe(0);
  });
});
