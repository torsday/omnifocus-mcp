/**
 * Tests for task_delete tool.
 *
 * Covers: schema validation, successful deletion, NotFound for unknown ID,
 * double-delete behavior, cache invalidation, and the three safety primitives
 * composed in `handleTaskDelete` (expectedModifiedAt, dry_run, idempotency_key).
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta, ToolEnvelope, ToolSuccess } from "../../envelope/index.js";
import { IdempotencyStore } from "../../server/idempotencyStore.js";
import { handleTaskDelete, taskDeleteInputSchema } from "./delete.js";

/** Narrow a handler envelope to ToolSuccess or fail the assertion. */
function assertOk<T>(envelope: ToolEnvelope<T>): ToolSuccess<T> {
  if (!("data" in envelope)) {
    throw new Error(`expected success envelope, got error: ${JSON.stringify(envelope)}`);
  }
  return envelope;
}

/**
 * Record every `cache.invalidated` event on the given cache. Returns the
 * mutable scope array; tests assert against it after the mutation.
 */
function recordScopes(cache: OmniFocusLruCache): InvalidationScope[] {
  const scopes: InvalidationScope[] = [];
  cache.on("cache.invalidated", (e: { scopes: InvalidationScope[] }) => {
    scopes.push(...e.scopes);
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
  // Per-test idempotency store so key reuse across tests does not leak.
  const idempotencyStore = new IdempotencyStore();
  return { ctx: { adapter, makeMeta, idempotencyStore }, adapter, idempotencyStore };
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

  it("accepts optional safety fields", () => {
    const parsed = taskDeleteInputSchema.parse({
      id: "task_000001",
      expectedModifiedAt: "2026-01-01T00:00:00Z",
      dry_run: true,
      idempotency_key: "k-1",
    });
    expect(parsed.expectedModifiedAt).toBe("2026-01-01T00:00:00Z");
    expect(parsed.dry_run).toBe(true);
    expect(parsed.idempotency_key).toBe("k-1");
  });

  it("rejects an empty idempotency_key", () => {
    expect(() => taskDeleteInputSchema.parse({ id: "task_000001", idempotency_key: "" })).toThrow();
  });

  it("rejects an idempotency_key > 128 chars", () => {
    expect(() =>
      taskDeleteInputSchema.parse({ id: "task_000001", idempotency_key: "x".repeat(129) }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("task_delete — handler", () => {
  it("deletes an existing task and returns { deleted: true, id }", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "To delete" });

    const envelope = assertOk(await handleTaskDelete({ id }, ctx));

    expect(envelope.data.deleted).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("sets meta.syncPending = true on deletion", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    const envelope = assertOk(await handleTaskDelete({ id }, ctx));
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

  it("does not invalidate on a dry_run preview", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createTask({ name: "T" });

    await handleTaskDelete({ id, dry_run: true }, { ...base, cache });

    expect(scopes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Safety primitives — expectedModifiedAt
// ---------------------------------------------------------------------------

describe("task_delete — expectedModifiedAt guard", () => {
  it("proceeds when expectedModifiedAt matches the current task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    const task = await adapter.getTask(id);
    const envelope = assertOk(
      await handleTaskDelete({ id, expectedModifiedAt: task.modifiedAt }, ctx),
    );
    expect(envelope.data.deleted).toBe(true);
  });

  it("throws ConflictError (OF_CONFLICT) when expectedModifiedAt is stale", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await expect(
      handleTaskDelete({ id, expectedModifiedAt: "2020-01-01T00:00:00Z" }, ctx),
    ).rejects.toMatchObject({ code: "OF_CONFLICT" });
  });

  it("does not delete the task when the guard trips", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await expect(
      handleTaskDelete({ id, expectedModifiedAt: "2020-01-01T00:00:00Z" }, ctx),
    ).rejects.toThrow();
    // Still retrievable
    const still = await adapter.getTask(id);
    expect(still.id).toBe(id);
  });

  it("raises ValidationError when expectedModifiedAt is malformed", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await expect(
      handleTaskDelete({ id, expectedModifiedAt: "not-a-timestamp" }, ctx),
    ).rejects.toMatchObject({ code: "OF_VALIDATION" });
  });
});

// ---------------------------------------------------------------------------
// Safety primitives — dry_run
// ---------------------------------------------------------------------------

describe("task_delete — dry_run", () => {
  it("returns a preview envelope without calling the adapter", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });

    const envelope = assertOk(await handleTaskDelete({ id, dry_run: true }, ctx));

    expect(envelope.data.deleted).toBe(true);
    expect(envelope.data.id).toBe(id);
    expect(envelope.meta.dryRun).toBe(true);
    expect(envelope.meta.syncPending).toBe(false);

    // Task still exists.
    const still = await adapter.getTask(id);
    expect(still.id).toBe(id);
  });

  it("dry_run still enforces expectedModifiedAt", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await expect(
      handleTaskDelete({ id, dry_run: true, expectedModifiedAt: "2020-01-01T00:00:00Z" }, ctx),
    ).rejects.toMatchObject({ code: "OF_CONFLICT" });
  });

  it("dry_run for a missing task still throws NotFound (pre-fetch path)", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTaskDelete(
        {
          id: "task_999999" as import("../../domain/ids.js").TaskId,
          dry_run: true,
        },
        ctx,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Safety primitives — idempotency_key
// ---------------------------------------------------------------------------

describe("task_delete — idempotency_key", () => {
  it("replays the original envelope on retry with the same key", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });

    const first = assertOk(await handleTaskDelete({ id, idempotency_key: "k-1" }, ctx));
    expect(first.data.deleted).toBe(true);
    expect(first.meta.idempotentReplay).toBeUndefined();

    // Second call with the same key — task is already gone, but the replay
    // returns the stored success envelope instead of re-raising NotFound.
    const second = assertOk(await handleTaskDelete({ id, idempotency_key: "k-1" }, ctx));
    expect(second.data.deleted).toBe(true);
    expect(second.data.id).toBe(id);
    expect(second.meta.idempotentReplay).toBe(true);
  });

  it("different keys are independent (each one triggers its own delete)", async () => {
    const { ctx, adapter } = makeCtx();
    const idA = await adapter.createTask({ name: "A" });
    const idB = await adapter.createTask({ name: "B" });

    await handleTaskDelete({ id: idA, idempotency_key: "a" }, ctx);
    await handleTaskDelete({ id: idB, idempotency_key: "b" }, ctx);

    await expect(adapter.getTask(idA)).rejects.toThrow();
    await expect(adapter.getTask(idB)).rejects.toThrow();
  });

  it("no key ⇒ no caching: second call raises NotFound", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });

    await handleTaskDelete({ id }, ctx);
    await expect(handleTaskDelete({ id }, ctx)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Safety primitives — composition
// ---------------------------------------------------------------------------

describe("task_delete — dry_run + idempotency_key composition", () => {
  it("a dry_run with a key replays the preview envelope, not a live delete", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });

    const first = assertOk(
      await handleTaskDelete({ id, dry_run: true, idempotency_key: "k-dry" }, ctx),
    );
    expect(first.meta.dryRun).toBe(true);
    expect(first.meta.syncPending).toBe(false);

    // Task still exists (dry run).
    expect((await adapter.getTask(id)).id).toBe(id);

    // Second call with the same key: replay of the dry-run envelope, even if
    // caller flipped dry_run off — the stored envelope wins under the idempotency
    // contract (same key → same outcome).
    const second = assertOk(
      await handleTaskDelete({ id, dry_run: false, idempotency_key: "k-dry" }, ctx),
    );
    expect(second.meta.dryRun).toBe(true);
    expect(second.meta.idempotentReplay).toBe(true);
    // Task still exists — live delete never ran.
    expect((await adapter.getTask(id)).id).toBe(id);
  });
});
