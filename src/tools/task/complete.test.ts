/**
 * Tests for task_complete tool.
 *
 * Covers: schema validation, successful completion, idempotency (noChange),
 * syncPending flag, cache invalidation, and clarification-needed for incomplete children.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import {
  isClarificationNeeded,
  isSuccess,
  type ResponseMeta,
  type ToolEnvelope,
} from "../../envelope/index.js";
import { ReplayStore } from "../../state/replayStore.js";
import { handleTaskComplete, taskCompleteInputSchema } from "./complete.js";

function recordScopes(cache: OmniFocusLruCache): InvalidationScope[] {
  const scopes: InvalidationScope[] = [];
  cache.on("cache.invalidated", (e: { scopes: InvalidationScope[] }) => {
    scopes.push(...e.scopes);
  });
  return scopes;
}

/** Cast to the wide ToolEnvelope type so isSuccess / isClarificationNeeded accept it. */
function asEnvelope(e: unknown): ToolEnvelope<unknown> {
  return e as ToolEnvelope<unknown>;
}

function makeCtx(replayStore?: ReplayStore) {
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
  const base = { adapter, makeMeta };
  const ctx = replayStore !== undefined ? { ...base, replayStore } : base;
  return { ctx, adapter };
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
// Handler — no children
// ---------------------------------------------------------------------------

describe("task_complete — handler (leaf task)", () => {
  it("returns { done: true, id } for an incomplete task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    const e = asEnvelope(await handleTaskComplete({ id }, ctx));
    expect(isSuccess(e)).toBe(true);
    if (!isSuccess(e)) throw new Error("not success");
    const data = e.data as { done: boolean; id: string };
    expect(data.done).toBe(true);
    expect(data.id).toBe(id);
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
    const e = asEnvelope(await handleTaskComplete({ id }, ctx));
    expect(isSuccess(e)).toBe(true);
    if (!isSuccess(e)) throw new Error("not success");
    const data = e.data as { noChange: boolean; id: string };
    expect(data.noChange).toBe(true);
    expect(data.id).toBe(id);
  });

  it("meta.syncPending is falsy when noChange", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Test" });
    await adapter.completeTask(id);
    const envelope = await handleTaskComplete({ id }, ctx);
    expect(envelope.meta.syncPending).toBeFalsy();
  });

  it("pairs name with id in the success payload (#572)", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Pay rent" });
    const envelope = await handleTaskComplete({ id }, ctx);
    if (!("data" in envelope)) {
      expect.fail("expected ok envelope (no children → no clarification)");
      return;
    }
    expect(envelope.data).toMatchObject({ done: true, id, name: "Pay rent" });
  });

  it("pairs name with id in the noChange payload (#572)", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Pay rent" });
    await adapter.completeTask(id);
    const envelope = await handleTaskComplete({ id }, ctx);
    if (!("data" in envelope)) {
      expect.fail("expected ok envelope on already-complete (no clarification)");
      return;
    }
    expect(envelope.data).toMatchObject({ noChange: true, id, name: "Pay rent" });
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
// Handler — clarification-needed for incomplete children
// ---------------------------------------------------------------------------

describe("task_complete — clarification-needed (incomplete children)", () => {
  it("returns clarification-needed when parent has incomplete children", async () => {
    const store = new ReplayStore(60_000);
    const { ctx, adapter } = makeCtx(store);

    const parentId = await adapter.createTask({ name: "Parent" });
    await adapter.createTask({ name: "Child", parentId });

    const e = asEnvelope(await handleTaskComplete({ id: parentId }, ctx));

    expect(isClarificationNeeded(e)).toBe(true);
    if (!isClarificationNeeded(e)) throw new Error("expected clarification-needed");
    expect(e.kind).toBe("clarification-needed");
    expect(e.question).toContain("Parent");
    expect(e.question).toContain("1 incomplete child");
    expect(e.options).toHaveLength(2);
    // biome-ignore lint/style/noNonNullAssertion: length asserted above
    expect(e.options![0]?.index).toBe(0);
    // biome-ignore lint/style/noNonNullAssertion: length asserted above
    expect(e.options![1]?.index).toBe(1);
    expect(typeof e.replayToken).toBe("string");
    expect(e.partial).toMatchObject({ id: parentId });
  });

  it("choice 0: completes parent and children", async () => {
    const store = new ReplayStore(60_000);
    const { ctx, adapter } = makeCtx(store);

    const parentId = await adapter.createTask({ name: "Parent" });
    const childId = await adapter.createTask({ name: "Child", parentId });

    const e = asEnvelope(await handleTaskComplete({ id: parentId }, ctx));
    if (!isClarificationNeeded(e)) throw new Error("expected clarification-needed");

    const entry = store.consume(e.replayToken);
    if (!entry) throw new Error("token not found");
    const result = asEnvelope(await entry.callback(0));

    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) throw new Error("not success");
    expect((result.data as { done: boolean }).done).toBe(true);

    const parent = await adapter.getTask(parentId);
    const child = await adapter.getTask(childId);
    expect(parent.completed).toBe(true);
    expect(child.completed).toBe(true);
  });

  it("choice 1: completes parent only, leaves children", async () => {
    const store = new ReplayStore(60_000);
    const { ctx, adapter } = makeCtx(store);

    const parentId = await adapter.createTask({ name: "Parent" });
    const childId = await adapter.createTask({ name: "Child", parentId });

    const e = asEnvelope(await handleTaskComplete({ id: parentId }, ctx));
    if (!isClarificationNeeded(e)) throw new Error("expected clarification-needed");

    const entry = store.consume(e.replayToken);
    if (!entry) throw new Error("token not found");
    await entry.callback(1);

    const parent = await adapter.getTask(parentId);
    const child = await adapter.getTask(childId);
    expect(parent.completed).toBe(true);
    expect(child.completed).toBe(false);
  });

  it("completes directly when no children exist", async () => {
    const store = new ReplayStore(60_000);
    const { ctx, adapter } = makeCtx(store);
    const id = await adapter.createTask({ name: "Leaf" });

    const e = asEnvelope(await handleTaskComplete({ id }, ctx));

    expect(isSuccess(e)).toBe(true);
    if (!isSuccess(e)) throw new Error("not success");
    expect((e.data as { done: boolean }).done).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("task_complete — cache invalidation", () => {
  it("emits task:${id}, forecast:*, perspective:*, search:*, tag:list for inbox task", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createTask({ name: "Inbox" });

    await handleTaskComplete({ id }, { ...base, cache });

    expect(scopes).toEqual([`task:${id}`, "forecast:*", "perspective:*", "search:*", "tag:list"]);
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
