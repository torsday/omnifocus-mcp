/**
 * Tests for task_uncomplete tool.
 *
 * Covers: schema validation, successful uncomplete, idempotency (noChange),
 * syncPending flag, and cache invalidation.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskUncomplete, taskUncompleteInputSchema } from "./uncomplete.js";

function recordScopes(cache: OmniFocusLruCache): InvalidationScope[] {
  const scopes: InvalidationScope[] = [];
  cache.on("cache.invalidated", (e: { scopes: InvalidationScope[] }) => {
    scopes.push(...e.scopes);
  });
  return scopes;
}

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
  return { ctx: { adapter, makeMeta }, adapter };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("task_uncomplete — input schema", () => {
  it("requires id", () => {
    expect(() => taskUncompleteInputSchema.parse({})).toThrow();
  });

  it("accepts a valid task ID", () => {
    const parsed = taskUncompleteInputSchema.parse({ id: "task_000001" });
    expect(parsed.id).toBe("task_000001");
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("task_uncomplete — handler", () => {
  it("returns { done: true, id } for a completed task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    await adapter.completeTask(id);
    const envelope = await handleTaskUncomplete({ id }, ctx);
    expect("done" in envelope.data && envelope.data.done).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("sets meta.syncPending = true when uncompleting", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    await adapter.completeTask(id);
    const envelope = await handleTaskUncomplete({ id }, ctx);
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("returns { noChange: true, id } for an already-incomplete task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    const envelope = await handleTaskUncomplete({ id }, ctx);
    expect("noChange" in envelope.data && envelope.data.noChange).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("meta.syncPending is falsy when noChange", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    const envelope = await handleTaskUncomplete({ id }, ctx);
    expect(envelope.meta.syncPending).toBeFalsy();
  });

  it("pairs name with id in the success payload (#572)", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Reopen" });
    await adapter.completeTask(id);
    const envelope = await handleTaskUncomplete({ id }, ctx);
    expect(envelope.data).toMatchObject({ done: true, id, name: "Reopen" });
  });

  it("pairs name with id in the noChange payload (#572)", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Reopen" });
    const envelope = await handleTaskUncomplete({ id }, ctx);
    expect(envelope.data).toMatchObject({ noChange: true, id, name: "Reopen" });
  });

  it("marks the task as incomplete in the adapter", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    await adapter.completeTask(id);
    await handleTaskUncomplete({ id }, ctx);
    const task = await adapter.getTask(id);
    expect(task.completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("task_uncomplete — cache invalidation", () => {
  it("emits task:${id}, forecast:*, perspective:*, search:* for inbox task", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createTask({ name: "Inbox" });
    await adapter.completeTask(id);

    await handleTaskUncomplete({ id }, { ...base, cache });

    expect(scopes).toEqual([`task:${id}`, "forecast:*", "perspective:*", "search:*"]);
  });

  it("does not invalidate on noChange", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createTask({ name: "T" });

    await handleTaskUncomplete({ id }, { ...base, cache });

    expect(scopes).toEqual([]);
  });
});
