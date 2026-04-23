/**
 * Tests for task_update tool.
 *
 * Covers: schema validation, scalar field patching, full-replacement tags,
 * additive tag diff (addTags/removeTags), setFlagged alias, validation error
 * on mixed tag modes, NotFound for unknown IDs.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskUpdate, taskUpdateInputSchema } from "./update.js";

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
    const envelope = await handleTaskUpdate({ id, name: "Updated" }, ctx);
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
