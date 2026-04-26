/**
 * Tests for task_batch_delete tool.
 *
 * Covers: schema validation, full success, partial failure (missing ID),
 * empty input rejection, cache invalidation signal.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskBatchDelete, taskBatchDeleteInputSchema } from "./batchDelete.js";

function makeCtx() {
  const adapter = new InMemoryAdapter();
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

describe("task_batch_delete — input schema", () => {
  it("rejects empty items array", () => {
    expect(() => taskBatchDeleteInputSchema.parse({ confirm: true, items: [] })).toThrow();
  });

  it("rejects when confirm is absent", () => {
    expect(() => taskBatchDeleteInputSchema.parse({ items: [{ id: "abc" }] })).toThrow();
  });

  it("rejects when confirm is false", () => {
    expect(() =>
      taskBatchDeleteInputSchema.parse({ confirm: false, items: [{ id: "abc" }] }),
    ).toThrow();
  });

  it("accepts a valid single item with confirm=true", () => {
    const result = taskBatchDeleteInputSchema.parse({ confirm: true, items: [{ id: "abc" }] });
    expect(result.items).toHaveLength(1);
  });

  it("accepts multiple items", () => {
    const result = taskBatchDeleteInputSchema.parse({
      confirm: true,
      items: [{ id: "abc" }, { id: "def" }],
    });
    expect(result.items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("task_batch_delete — handler", () => {
  it("deletes all tasks and returns deleted[] on full success", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "Task A" });
    const id2 = await adapter.createTask({ name: "Task B" });

    const result = await handleTaskBatchDelete(
      { confirm: true, items: [{ id: id1 }, { id: id2 }] },
      ctx,
    );

    expect(result.data.deleted).toHaveLength(2);
    expect(result.data.failed).toHaveLength(0);
    // Tasks should be gone
    await expect(adapter.getTask(id1)).rejects.toThrow();
    await expect(adapter.getTask(id2)).rejects.toThrow();
  });

  it("reports partial failure when one ID does not exist", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "Real Task" });
    const missing = "nonexistent-id" as typeof id1;

    const result = await handleTaskBatchDelete(
      { confirm: true, items: [{ id: id1 }, { id: missing }] },
      ctx,
    );

    expect(result.data.deleted).toHaveLength(1);
    expect(result.data.deleted[0]?.index).toBe(0);
    expect(result.data.failed).toHaveLength(1);
    expect(result.data.failed[0]?.index).toBe(1);
  });

  it("sets syncPending=true in meta when at least one task deleted", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "To Delete" });

    const result = await handleTaskBatchDelete({ confirm: true, items: [{ id }] }, ctx);

    expect(result.meta.syncPending).toBe(true);
  });

  it("sets syncPending=false in meta when all items fail", async () => {
    const { ctx } = makeCtx();

    const result = await handleTaskBatchDelete(
      { confirm: true, items: [{ id: "no-such-id" as never }] },
      ctx,
    );

    expect(result.data.deleted).toHaveLength(0);
    expect(result.data.failed).toHaveLength(1);
    expect(result.meta.syncPending).toBe(false);
  });

  it("preserves per-index positions in mixed success/failure", async () => {
    const { ctx, adapter } = makeCtx();
    const id0 = await adapter.createTask({ name: "T0" });
    const id2 = await adapter.createTask({ name: "T2" });

    const result = await handleTaskBatchDelete(
      { confirm: true, items: [{ id: id0 }, { id: "missing" as typeof id0 }, { id: id2 }] },
      ctx,
    );

    expect(result.data.deleted.map((d) => d.index)).toEqual([0, 2]);
    expect(result.data.failed.map((f) => f.index)).toEqual([1]);
  });
});
