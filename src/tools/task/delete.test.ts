/**
 * Tests for task_delete tool.
 *
 * Covers: schema validation, successful deletion, NotFound for unknown ID,
 * idempotency (double-delete raises NotFound), and response shape.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskDelete, taskDeleteInputSchema } from "./delete.js";

/**
 * Record every `cache.invalidated` event on the given cache. Returns the
 * mutable scope array; tests assert against it after the mutation.
 */
function recordScopes(cache: OmniFocusLruCache): InvalidationScope[] {
  const scopes: InvalidationScope[] = [];
  cache.on("cache.invalidated", (e: { scope: InvalidationScope }) => {
    scopes.push(e.scope);
  });
  return scopes;
}

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
  return { ctx: { adapter, makeMeta }, adapter };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("task_delete — input schema", () => {
  it("requires id", () => {
    expect(() => taskDeleteInputSchema.parse({})).toThrow();
  });

  it("accepts a valid task ID", () => {
    const parsed = taskDeleteInputSchema.parse({ id: "task_000001" });
    expect(parsed.id).toBe("task_000001");
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("task_delete — handler", () => {
  it("deletes an existing task and returns { deleted: true, id }", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "To delete" });

    const envelope = await handleTaskDelete({ id }, ctx);

    expect(envelope.data.deleted).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("sets meta.syncPending = true on deletion", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    const envelope = await handleTaskDelete({ id }, ctx);
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("removes the task from the adapter", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await handleTaskDelete({ id }, ctx);

    // getTask should throw NotFound
    await expect(adapter.getTask(id)).rejects.toThrow();
  });

  it("throws NotFound for unknown task ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTaskDelete({ id: "task_999999" as import("../../domain/ids.js").TaskId }, ctx),
    ).rejects.toThrow();
  });

  it("double-delete raises NotFound (not silent)", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await handleTaskDelete({ id }, ctx);
    await expect(handleTaskDelete({ id }, ctx)).rejects.toThrow();
  });

  it("deleting one task does not affect sibling tasks", async () => {
    const { ctx, adapter } = makeCtx();
    const idA = await adapter.createTask({ name: "A" });
    const idB = await adapter.createTask({ name: "B" });
    await handleTaskDelete({ id: idA }, ctx);
    const remaining = await adapter.listTasks({});
    expect(remaining.some((t) => t.id === idB)).toBe(true);
    expect(remaining.some((t) => t.id === idA)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation (docs/cache-invalidation.md)
// ---------------------------------------------------------------------------

describe("task_delete — cache invalidation", () => {
  it("emits task:${id}, project:${projectId}, forecast:*, perspective:*, search:* for a project task", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const projectId = await adapter.createProject({ name: "P" });
    const id = await adapter.createTask({ name: "T", projectId });

    await handleTaskDelete({ id }, { ...base, cache });

    expect(scopes).toEqual([
      `task:${id}`,
      `project:${projectId}`,
      "forecast:*",
      "perspective:*",
      "search:*",
    ]);
  });

  it("skips project:${id} for an inbox task (projectId === null)", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createTask({ name: "Inbox" });

    await handleTaskDelete({ id }, { ...base, cache });

    expect(scopes).toEqual([`task:${id}`, "forecast:*", "perspective:*", "search:*"]);
  });

  it("does not invalidate when the delete fails (NotFound raised before write)", async () => {
    const { ctx: base } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    await expect(
      handleTaskDelete(
        { id: "task_999999" as import("../../domain/ids.js").TaskId },
        { ...base, cache },
      ),
    ).rejects.toThrow();
    expect(scopes).toEqual([]);
  });
});
