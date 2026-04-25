/**
 * Tests for task_complete tool.
 *
 * Covers: schema validation, successful completion, idempotency (noChange),
 * syncPending flag, and cache invalidation.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskComplete, taskCompleteInputSchema } from "./complete.js";

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

describe("task_complete — input schema", () => {
  it("requires id", () => {
    expect(() => taskCompleteInputSchema.parse({})).toThrow();
  });

  it("accepts id only", () => {
    const parsed = taskCompleteInputSchema.parse({ id: "task_000001" });
    expect(parsed.id).toBe("task_000001");
  });

  it("accepts id + at with offset", () => {
    const parsed = taskCompleteInputSchema.parse({
      id: "task_000001",
      at: "2026-01-01T12:00:00+00:00",
    });
    expect(parsed.at).toBe("2026-01-01T12:00:00+00:00");
  });

  it("rejects at without timezone offset", () => {
    expect(() =>
      taskCompleteInputSchema.parse({ id: "task_000001", at: "2026-01-01T12:00:00" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("task_complete — handler", () => {
  it("returns { done: true, id } for an incomplete task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    const envelope = await handleTaskComplete({ id }, ctx);
    expect("done" in envelope.data && envelope.data.done).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("sets meta.syncPending = true when completing", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    const envelope = await handleTaskComplete({ id }, ctx);
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("returns { noChange: true, id } for an already-completed task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    await adapter.completeTask(id);
    const envelope = await handleTaskComplete({ id }, ctx);
    expect("noChange" in envelope.data && envelope.data.noChange).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("meta.syncPending is falsy when noChange", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    await adapter.completeTask(id);
    const envelope = await handleTaskComplete({ id }, ctx);
    expect(envelope.meta.syncPending).toBeFalsy();
  });

  it("marks the task as completed in the adapter", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    await handleTaskComplete({ id }, ctx);
    const task = await adapter.getTask(id);
    expect(task.completed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("task_complete — cache invalidation", () => {
  it("emits task:${id}, forecast:*, perspective:*, search:* for inbox task", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createTask({ name: "Inbox" });

    await handleTaskComplete({ id }, { ...base, cache });

    expect(scopes).toEqual([`task:${id}`, "forecast:*", "perspective:*", "search:*"]);
  });

  it("emits project:${projectId} for a project task", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const projectId = await adapter.createProject({ name: "P" });
    const id = await adapter.createTask({ name: "T", projectId });

    await handleTaskComplete({ id }, { ...base, cache });

    expect(scopes).toContain(`project:${projectId}`);
  });

  it("does not invalidate on noChange", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createTask({ name: "T" });
    await adapter.completeTask(id);

    await handleTaskComplete({ id }, { ...base, cache });

    expect(scopes).toEqual([]);
  });
});
