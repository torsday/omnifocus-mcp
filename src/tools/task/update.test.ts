/**
 * Tests for task_update tool.
 *
 * Covers: schema validation, scalar field patching, full-replacement tags,
 * additive tag diff (addTags/removeTags), setFlagged alias, validation error
 * on mixed tag modes, NotFound for unknown IDs.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta, ToolEnvelope, ToolSuccess } from "../../envelope/index.js";
import { IdempotencyStore } from "../../server/idempotencyStore.js";
import { handleTaskUpdate, taskUpdateInputSchema } from "./update.js";

/** Narrow a handler envelope to ToolSuccess or fail the assertion. */
function assertOk<T>(envelope: ToolEnvelope<T>): ToolSuccess<T> {
  if (!("data" in envelope)) {
    throw new Error(`expected success envelope, got error: ${JSON.stringify(envelope)}`);
  }
  return envelope;
}

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
  const idempotencyStore = new IdempotencyStore();
  return { ctx: { adapter, makeMeta, idempotencyStore }, adapter, idempotencyStore };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("task_update — input schema", () => {
  it("requires id", () => {
    expect(() => taskUpdateInputSchema.parse({})).toThrow();
  });

  it("accepts id-only (no-op patch)", () => {
    const parsed = taskUpdateInputSchema.parse({ id: "task_000001" });
    expect(parsed.id).toBe("task_000001");
  });

  it("rejects empty name", () => {
    expect(() => taskUpdateInputSchema.parse({ id: "task_000001", name: "" })).toThrow();
  });

  it("accepts null dueDate", () => {
    const parsed = taskUpdateInputSchema.parse({ id: "task_000001", dueDate: null });
    expect(parsed.dueDate).toBeNull();
  });

  it("accepts setFlagged", () => {
    const parsed = taskUpdateInputSchema.parse({ id: "task_000001", setFlagged: true });
    expect(parsed.setFlagged).toBe(true);
  });

  it("rejects tagIds combined with addTags", () => {
    expect(() =>
      taskUpdateInputSchema.parse({
        id: "task_000001",
        tagIds: ["tag_000001"],
        addTags: ["tag_000002"],
      }),
    ).toThrow();
  });

  it("rejects tagIds combined with removeTags", () => {
    expect(() =>
      taskUpdateInputSchema.parse({
        id: "task_000001",
        tagIds: ["tag_000001"],
        removeTags: ["tag_000001"],
      }),
    ).toThrow();
  });

  it("rejects dueDate earlier than deferDate", () => {
    expect(() =>
      taskUpdateInputSchema.parse({
        id: "task_000001",
        deferDate: "2025-06-01T00:00:00+00:00",
        dueDate: "2025-05-01T00:00:00+00:00",
      }),
    ).toThrow();
  });

  it("accepts dueDate equal to deferDate", () => {
    const parsed = taskUpdateInputSchema.parse({
      id: "task_000001",
      deferDate: "2025-06-01T00:00:00+00:00",
      dueDate: "2025-06-01T00:00:00+00:00",
    });
    expect(parsed.dueDate).toBe("2025-06-01T00:00:00+00:00");
  });

  it("accepts dueDate after deferDate", () => {
    const parsed = taskUpdateInputSchema.parse({
      id: "task_000001",
      deferDate: "2025-05-01T00:00:00+00:00",
      dueDate: "2025-06-01T00:00:00+00:00",
    });
    expect(parsed.dueDate).toBe("2025-06-01T00:00:00+00:00");
  });

  it("accepts dueDate with no deferDate in patch", () => {
    const parsed = taskUpdateInputSchema.parse({
      id: "task_000001",
      dueDate: "2025-05-01T00:00:00+00:00",
    });
    expect(parsed.dueDate).toBe("2025-05-01T00:00:00+00:00");
  });

  it("accepts addTags and removeTags together (no tagIds)", () => {
    const parsed = taskUpdateInputSchema.parse({
      id: "task_000001",
      addTags: ["tag_000001"],
      removeTags: ["tag_000002"],
    });
    expect(parsed.addTags).toEqual(["tag_000001"]);
    expect(parsed.removeTags).toEqual(["tag_000002"]);
  });
});

// ---------------------------------------------------------------------------
// Handler — scalar fields
// ---------------------------------------------------------------------------

describe("task_update — handler: scalar fields", () => {
  it("renames a task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Old" });
    await handleTaskUpdate({ id, name: "New" }, ctx);
    const task = await adapter.getTask(id);
    expect(task.name).toBe("New");
  });

  it("sets and clears note", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await handleTaskUpdate({ id, note: "hello" }, ctx);
    expect((await adapter.getTask(id)).note).toBe("hello");
    await handleTaskUpdate({ id, note: null }, ctx);
    expect((await adapter.getTask(id)).note).toBeNull();
  });

  it("sets flagged via flagged field", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await handleTaskUpdate({ id, flagged: true }, ctx);
    expect((await adapter.getTask(id)).flagged).toBe(true);
  });

  it("sets flagged via setFlagged alias", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await handleTaskUpdate({ id, setFlagged: true }, ctx);
    expect((await adapter.getTask(id)).flagged).toBe(true);
    await handleTaskUpdate({ id, setFlagged: false }, ctx);
    expect((await adapter.getTask(id)).flagged).toBe(false);
  });

  it("sets and clears dueDate", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await handleTaskUpdate({ id, dueDate: "2026-06-01T00:00:00Z" }, ctx);
    expect((await adapter.getTask(id)).dueDate).toBe("2026-06-01T00:00:00Z");
    await handleTaskUpdate({ id, dueDate: null }, ctx);
    expect((await adapter.getTask(id)).dueDate).toBeNull();
  });

  it("sets estimatedMinutes and clears it", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await handleTaskUpdate({ id, estimatedMinutes: 30 }, ctx);
    expect((await adapter.getTask(id)).estimatedMinutes).toBe(30);
    await handleTaskUpdate({ id, estimatedMinutes: null }, ctx);
    expect((await adapter.getTask(id)).estimatedMinutes).toBeNull();
  });

  it("sets sequential", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await handleTaskUpdate({ id, sequential: true }, ctx);
    expect((await adapter.getTask(id)).sequential).toBe(true);
  });

  it("returns the full updated task entity", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    const envelope = assertOk(await handleTaskUpdate({ id, name: "Updated" }, ctx));
    expect(envelope.data.task.id).toBe(id);
    expect(envelope.data.task.name).toBe("Updated");
    expect(envelope.meta.syncPending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Handler — tag full-replacement mode
// ---------------------------------------------------------------------------

describe("task_update — handler: tagIds full replacement", () => {
  it("replaces all tags", async () => {
    const { ctx, adapter } = makeCtx();
    const tagA = await adapter.createTag({ name: "A" });
    const tagB = await adapter.createTag({ name: "B" });
    const id = await adapter.createTask({ name: "T", tagIds: [tagA] });
    await handleTaskUpdate({ id, tagIds: [tagB] }, ctx);
    expect((await adapter.getTask(id)).tagIds).toEqual([tagB]);
  });

  it("clears all tags when tagIds is empty array", async () => {
    const { ctx, adapter } = makeCtx();
    const tagA = await adapter.createTag({ name: "A" });
    const id = await adapter.createTask({ name: "T", tagIds: [tagA] });
    await handleTaskUpdate({ id, tagIds: [] }, ctx);
    expect((await adapter.getTask(id)).tagIds).toEqual([]);
  });

  it("throws NotFound for unknown tag in tagIds", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await expect(
      handleTaskUpdate({ id, tagIds: ["tag_999999" as import("../../domain/ids.js").TagId] }, ctx),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler — additive tag diff mode
// ---------------------------------------------------------------------------

describe("task_update — handler: addTags/removeTags", () => {
  it("adds tags without affecting existing ones", async () => {
    const { ctx, adapter } = makeCtx();
    const tagA = await adapter.createTag({ name: "A" });
    const tagB = await adapter.createTag({ name: "B" });
    const id = await adapter.createTask({ name: "T", tagIds: [tagA] });
    await handleTaskUpdate({ id, addTags: [tagB] }, ctx);
    const task = await adapter.getTask(id);
    expect(task.tagIds).toContain(tagA);
    expect(task.tagIds).toContain(tagB);
  });

  it("addTags is a no-op for tags already present", async () => {
    const { ctx, adapter } = makeCtx();
    const tagA = await adapter.createTag({ name: "A" });
    const id = await adapter.createTask({ name: "T", tagIds: [tagA] });
    await handleTaskUpdate({ id, addTags: [tagA] }, ctx);
    expect((await adapter.getTask(id)).tagIds).toEqual([tagA]);
  });

  it("removes tags without affecting others", async () => {
    const { ctx, adapter } = makeCtx();
    const tagA = await adapter.createTag({ name: "A" });
    const tagB = await adapter.createTag({ name: "B" });
    const id = await adapter.createTask({ name: "T", tagIds: [tagA, tagB] });
    await handleTaskUpdate({ id, removeTags: [tagA] }, ctx);
    expect((await adapter.getTask(id)).tagIds).toEqual([tagB]);
  });

  it("removeTags is a no-op for absent tags", async () => {
    const { ctx, adapter } = makeCtx();
    const tagA = await adapter.createTag({ name: "A" });
    const tagB = await adapter.createTag({ name: "B" });
    const id = await adapter.createTask({ name: "T", tagIds: [tagA] });
    await handleTaskUpdate({ id, removeTags: [tagB] }, ctx);
    expect((await adapter.getTask(id)).tagIds).toEqual([tagA]);
  });

  it("applies addTags and removeTags simultaneously", async () => {
    const { ctx, adapter } = makeCtx();
    const tagA = await adapter.createTag({ name: "A" });
    const tagB = await adapter.createTag({ name: "B" });
    const id = await adapter.createTask({ name: "T", tagIds: [tagA] });
    await handleTaskUpdate({ id, addTags: [tagB], removeTags: [tagA] }, ctx);
    const task = await adapter.getTask(id);
    expect(task.tagIds).toContain(tagB);
    expect(task.tagIds).not.toContain(tagA);
  });
});

// ---------------------------------------------------------------------------
// Handler — error cases
// ---------------------------------------------------------------------------

describe("task_update — handler: error cases", () => {
  it("throws NotFound for unknown task ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTaskUpdate(
        { id: "task_999999" as import("../../domain/ids.js").TaskId, name: "X" },
        ctx,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation (docs/cache-invalidation.md)
// ---------------------------------------------------------------------------

describe("task_update — cache invalidation", () => {
  it("emits the task-mutation scope set after a successful update", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const projectId = await adapter.createProject({ name: "P" });
    const id = await adapter.createTask({ name: "T", projectId });

    await handleTaskUpdate({ id, name: "renamed" }, { ...base, cache });

    expect(scopes).toEqual([
      `task:${id}`,
      `project:${projectId}`,
      "forecast:*",
      "perspective:*",
      "search:*",
    ]);
  });

  it("skips project:${id} when the task is in the inbox", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createTask({ name: "Inbox" });

    await handleTaskUpdate({ id, flagged: true }, { ...base, cache });

    expect(scopes).toEqual([`task:${id}`, "forecast:*", "perspective:*", "search:*"]);
  });

  it("emits the parent task scope when updating a subtask", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const parentId = await adapter.createTask({ name: "Parent" });
    const id = await adapter.createTask({ name: "Child", parentId });

    await handleTaskUpdate({ id, name: "renamed child" }, { ...base, cache });

    expect(scopes).toEqual([
      `task:${id}`,
      `task:${parentId}`,
      "forecast:*",
      "perspective:*",
      "search:*",
    ]);
  });

  it("does not invalidate on a dry_run preview", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createTask({ name: "T" });

    await handleTaskUpdate({ id, name: "renamed", dry_run: true }, { ...base, cache });

    expect(scopes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Schema — optional safety fields
// ---------------------------------------------------------------------------

describe("task_update — input schema: safety fields", () => {
  it("accepts optional safety fields", () => {
    const parsed = taskUpdateInputSchema.parse({
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
    expect(() => taskUpdateInputSchema.parse({ id: "task_000001", idempotency_key: "" })).toThrow();
  });

  it("rejects an idempotency_key > 128 chars", () => {
    expect(() =>
      taskUpdateInputSchema.parse({ id: "task_000001", idempotency_key: "x".repeat(129) }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Safety primitives — expectedModifiedAt
// ---------------------------------------------------------------------------

describe("task_update — expectedModifiedAt guard", () => {
  it("proceeds when expectedModifiedAt matches the current task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    const task = await adapter.getTask(id);
    const envelope = assertOk(
      await handleTaskUpdate({ id, name: "New", expectedModifiedAt: task.modifiedAt }, ctx),
    );
    expect(envelope.data.task.name).toBe("New");
  });

  it("throws ConflictError (OF_CONFLICT) when expectedModifiedAt is stale", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await expect(
      handleTaskUpdate({ id, name: "New", expectedModifiedAt: "2020-01-01T00:00:00Z" }, ctx),
    ).rejects.toMatchObject({ code: "OF_CONFLICT" });
  });

  it("does not patch the task when the guard trips", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Original" });
    await expect(
      handleTaskUpdate({ id, name: "New", expectedModifiedAt: "2020-01-01T00:00:00Z" }, ctx),
    ).rejects.toThrow();
    const still = await adapter.getTask(id);
    expect(still.name).toBe("Original");
  });

  it("raises ValidationError when expectedModifiedAt is malformed", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await expect(
      handleTaskUpdate({ id, name: "New", expectedModifiedAt: "not-a-timestamp" }, ctx),
    ).rejects.toMatchObject({ code: "OF_VALIDATION" });
  });
});

// ---------------------------------------------------------------------------
// Safety primitives — dry_run
// ---------------------------------------------------------------------------

describe("task_update — dry_run", () => {
  it("returns the patched task as preview without mutating the adapter", async () => {
    const { ctx, adapter } = makeCtx();
    const tagA = await adapter.createTag({ name: "A" });
    const id = await adapter.createTask({ name: "Original", flagged: false });

    const envelope = assertOk(
      await handleTaskUpdate(
        { id, name: "Renamed", flagged: true, tagIds: [tagA], dry_run: true },
        ctx,
      ),
    );

    expect(envelope.data.task.id).toBe(id);
    expect(envelope.data.task.name).toBe("Renamed");
    expect(envelope.data.task.flagged).toBe(true);
    expect(envelope.data.task.tagIds).toEqual([tagA]);
    expect(envelope.meta.dryRun).toBe(true);
    expect(envelope.meta.syncPending).toBe(false);

    // Underlying task unchanged.
    const still = await adapter.getTask(id);
    expect(still.name).toBe("Original");
    expect(still.flagged).toBe(false);
    expect(still.tagIds).toEqual([]);
  });

  it("dry_run merges additive tag diff onto the current tag set for preview", async () => {
    const { ctx, adapter } = makeCtx();
    const tagA = await adapter.createTag({ name: "A" });
    const tagB = await adapter.createTag({ name: "B" });
    const id = await adapter.createTask({ name: "T", tagIds: [tagA] });

    const envelope = assertOk(await handleTaskUpdate({ id, addTags: [tagB], dry_run: true }, ctx));

    expect(envelope.data.task.tagIds).toContain(tagA);
    expect(envelope.data.task.tagIds).toContain(tagB);
    expect(envelope.meta.dryRun).toBe(true);

    // Adapter state unchanged.
    const still = await adapter.getTask(id);
    expect(still.tagIds).toEqual([tagA]);
  });

  it("dry_run still enforces expectedModifiedAt", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await expect(
      handleTaskUpdate(
        {
          id,
          name: "New",
          dry_run: true,
          expectedModifiedAt: "2020-01-01T00:00:00Z",
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "OF_CONFLICT" });
  });

  it("dry_run for a missing task still throws NotFound (pre-fetch path)", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTaskUpdate(
        {
          id: "task_999999" as import("../../domain/ids.js").TaskId,
          name: "X",
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

describe("task_update — idempotency_key", () => {
  it("replays the original envelope on retry with the same key", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Original" });

    const first = assertOk(
      await handleTaskUpdate({ id, name: "Renamed", idempotency_key: "k-1" }, ctx),
    );
    expect(first.data.task.name).toBe("Renamed");
    expect(first.meta.idempotentReplay).toBeUndefined();

    // Second call with the same key replays the first envelope even though the
    // input (name) differs — same key → same outcome contract.
    const second = assertOk(
      await handleTaskUpdate({ id, name: "Different", idempotency_key: "k-1" }, ctx),
    );
    expect(second.data.task.name).toBe("Renamed");
    expect(second.meta.idempotentReplay).toBe(true);

    // Adapter saw only one write.
    const live = await adapter.getTask(id);
    expect(live.name).toBe("Renamed");
  });

  it("different keys are independent (each one triggers its own update)", async () => {
    const { ctx, adapter } = makeCtx();
    const idA = await adapter.createTask({ name: "A" });
    const idB = await adapter.createTask({ name: "B" });

    await handleTaskUpdate({ id: idA, name: "A2", idempotency_key: "a" }, ctx);
    await handleTaskUpdate({ id: idB, name: "B2", idempotency_key: "b" }, ctx);

    expect((await adapter.getTask(idA)).name).toBe("A2");
    expect((await adapter.getTask(idB)).name).toBe("B2");
  });

  it("no key ⇒ no caching: second call re-applies the patch", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });

    await handleTaskUpdate({ id, name: "First" }, ctx);
    await handleTaskUpdate({ id, name: "Second" }, ctx);

    expect((await adapter.getTask(id)).name).toBe("Second");
  });
});

// ---------------------------------------------------------------------------
// Safety primitives — composition
// ---------------------------------------------------------------------------

describe("task_update — dry_run + idempotency_key composition", () => {
  it("a dry_run with a key replays the preview envelope, not a live update", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Original" });

    const first = assertOk(
      await handleTaskUpdate({ id, name: "Preview", dry_run: true, idempotency_key: "k-dry" }, ctx),
    );
    expect(first.meta.dryRun).toBe(true);
    expect(first.meta.syncPending).toBe(false);
    expect(first.data.task.name).toBe("Preview");
    expect((await adapter.getTask(id)).name).toBe("Original");

    // Second call reuses the stored dry-run envelope even when dry_run flips off.
    const second = assertOk(
      await handleTaskUpdate(
        { id, name: "LiveAttempt", dry_run: false, idempotency_key: "k-dry" },
        ctx,
      ),
    );
    expect(second.meta.dryRun).toBe(true);
    expect(second.meta.idempotentReplay).toBe(true);
    expect(second.data.task.name).toBe("Preview");
    expect((await adapter.getTask(id)).name).toBe("Original");
  });
});
