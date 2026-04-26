/**
 * Tests for task_batch_undrop tool.
 *
 * Covers: schema validation, full success, partial failure (missing ID),
 * empty input rejection, undropped state verified, syncPending flag.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskBatchUndrop, taskBatchUndropInputSchema } from "./batchUndrop.js";

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

describe("task_batch_undrop — input schema", () => {
  it("rejects empty items array", () => {
    expect(() => taskBatchUndropInputSchema.parse({ items: [] })).toThrow();
  });

  it("accepts a valid single item", () => {
    const result = taskBatchUndropInputSchema.parse({ items: [{ id: "abc" }] });
    expect(result.items).toHaveLength(1);
  });

  it("accepts multiple items", () => {
    const result = taskBatchUndropInputSchema.parse({ items: [{ id: "abc" }, { id: "def" }] });
    expect(result.items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("task_batch_undrop — handler", () => {
  it("undrops all tasks and returns undropped[] on full success", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "Task A" });
    const id2 = await adapter.createTask({ name: "Task B" });
    // Drop them first
    await adapter.dropTask(id1);
    await adapter.dropTask(id2);

    const result = await handleTaskBatchUndrop({ items: [{ id: id1 }, { id: id2 }] }, ctx);

    expect(result.data.undropped).toHaveLength(2);
    expect(result.data.failed).toHaveLength(0);
    // Tasks should be restored to active
    const t1 = await adapter.getTask(id1);
    const t2 = await adapter.getTask(id2);
    expect(t1.dropped).toBe(false);
    expect(t2.dropped).toBe(false);
  });

  it("reports partial failure when one ID does not exist", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "Real Task" });
    await adapter.dropTask(id1);
    const missing = "nonexistent-id" as typeof id1;

    const result = await handleTaskBatchUndrop({ items: [{ id: id1 }, { id: missing }] }, ctx);

    expect(result.data.undropped).toHaveLength(1);
    expect(result.data.undropped[0]?.index).toBe(0);
    expect(result.data.failed).toHaveLength(1);
    expect(result.data.failed[0]?.index).toBe(1);
  });

  it("sets syncPending=true in meta when at least one task undropped", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "To Undrop" });
    await adapter.dropTask(id);

    const result = await handleTaskBatchUndrop({ items: [{ id }] }, ctx);

    expect(result.meta.syncPending).toBe(true);
  });

  it("sets syncPending=false in meta when all items fail", async () => {
    const { ctx } = makeCtx();

    const result = await handleTaskBatchUndrop({ items: [{ id: "no-such-id" as never }] }, ctx);

    expect(result.data.undropped).toHaveLength(0);
    expect(result.data.failed).toHaveLength(1);
    expect(result.meta.syncPending).toBe(false);
  });

  it("preserves per-index positions in mixed success/failure", async () => {
    const { ctx, adapter } = makeCtx();
    const id0 = await adapter.createTask({ name: "T0" });
    const id2 = await adapter.createTask({ name: "T2" });
    await adapter.dropTask(id0);
    await adapter.dropTask(id2);

    const result = await handleTaskBatchUndrop(
      { items: [{ id: id0 }, { id: "missing" as typeof id0 }, { id: id2 }] },
      ctx,
    );

    expect(result.data.undropped.map((d) => d.index)).toEqual([0, 2]);
    expect(result.data.failed.map((f) => f.index)).toEqual([1]);
  });

  it("undropping a non-dropped task still succeeds (idempotent)", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Active Task" });
    // Task is not dropped — undrop is still a valid no-op

    const result = await handleTaskBatchUndrop({ items: [{ id }] }, ctx);

    expect(result.data.undropped).toHaveLength(1);
    expect(result.data.failed).toHaveLength(0);
    const task = await adapter.getTask(id);
    expect(task.dropped).toBe(false);
  });
});
