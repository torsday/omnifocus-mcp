/**
 * Tests for task_drop tool.
 *
 * Covers: schema validation, successful drop, idempotency (noChange),
 * syncPending flag, and cache invalidation.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskDrop, taskDropInputSchema } from "./drop.js";

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

describe("task_drop — input schema", () => {
  it("requires id", () => {
    expect(() => taskDropInputSchema.parse({})).toThrow();
  });

  it("accepts id only", () => {
    const parsed = taskDropInputSchema.parse({ id: "task_000001" });
    expect(parsed.id).toBe("task_000001");
  });

  it("accepts id + at with offset", () => {
    const parsed = taskDropInputSchema.parse({
      id: "task_000001",
      at: "2026-01-01T12:00:00+00:00",
    });
    expect(parsed.at).toBe("2026-01-01T12:00:00+00:00");
  });

  it("rejects at without timezone offset", () => {
    expect(() =>
      taskDropInputSchema.parse({ id: "task_000001", at: "2026-01-01T12:00:00" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("task_drop — handler", () => {
  it("returns { done: true, id } for an active task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    const envelope = await handleTaskDrop({ id }, ctx);
    expect("done" in envelope.data && envelope.data.done).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("sets meta.syncPending = true when dropping", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    const envelope = await handleTaskDrop({ id }, ctx);
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("returns { noChange: true, id } for an already-dropped task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    await adapter.dropTask(id);
    const envelope = await handleTaskDrop({ id }, ctx);
    expect("noChange" in envelope.data && envelope.data.noChange).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("meta.syncPending is falsy when noChange", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    await adapter.dropTask(id);
    const envelope = await handleTaskDrop({ id }, ctx);
    expect(envelope.meta.syncPending).toBeFalsy();
  });

  it("marks the task as dropped in the adapter", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    await handleTaskDrop({ id }, ctx);
    const task = await adapter.getTask(id);
    expect(task.dropped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("task_drop — cache invalidation", () => {
  it("emits task:${id}, forecast:*, perspective:*, search:* for inbox task", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createTask({ name: "Inbox" });

    await handleTaskDrop({ id }, { ...base, cache });

    expect(scopes).toEqual([`task:${id}`, "forecast:*", "perspective:*", "search:*"]);
  });

  it("emits project:${projectId} for a project task", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const projectId = await adapter.createProject({ name: "P" });
    const id = await adapter.createTask({ name: "T", projectId });

    await handleTaskDrop({ id }, { ...base, cache });

    expect(scopes).toContain(`project:${projectId}`);
  });

  it("does not invalidate on noChange", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createTask({ name: "T" });
    await adapter.dropTask(id);

    await handleTaskDrop({ id }, { ...base, cache });

    expect(scopes).toEqual([]);
  });
});
