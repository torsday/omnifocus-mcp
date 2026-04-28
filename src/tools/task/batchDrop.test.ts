/**
 * Tests for task_batch_drop tool.
 *
 * Covers: schema validation, full success, partial failure (missing ID),
 * empty input rejection, dropped state verified, syncPending flag.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskBatchDrop, taskBatchDropInputSchema } from "./batchDrop.js";

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

describe("task_batch_drop — input schema", () => {
  it("rejects empty items array", () => {
    expect(() => taskBatchDropInputSchema.parse({ items: [] })).toThrow();
  });

  it("accepts a valid single item", () => {
    const result = taskBatchDropInputSchema.parse({ items: [{ id: "abc" }] });
    expect(result.items).toHaveLength(1);
  });

  it("accepts multiple items", () => {
    const result = taskBatchDropInputSchema.parse({ items: [{ id: "abc" }, { id: "def" }] });
    expect(result.items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("task_batch_drop — handler", () => {
  it("drops all tasks and returns dropped[] on full success", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "Task A" });
    const id2 = await adapter.createTask({ name: "Task B" });

    const result = await handleTaskBatchDrop({ items: [{ id: id1 }, { id: id2 }] }, ctx);

    expect(result.data.dropped).toHaveLength(2);
    expect(result.data.failed).toHaveLength(0);
    // Tasks should be marked dropped
    const t1 = await adapter.getTask(id1);
    const t2 = await adapter.getTask(id2);
    expect(t1.dropped).toBe(true);
    expect(t2.dropped).toBe(true);
  });

  it("reports partial failure when one ID does not exist", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "Real Task" });
    const missing = "nonexistent-id" as typeof id1;

    const result = await handleTaskBatchDrop({ items: [{ id: id1 }, { id: missing }] }, ctx);

    expect(result.data.dropped).toHaveLength(1);
    expect(result.data.dropped[0]?.index).toBe(0);
    expect(result.data.failed).toHaveLength(1);
    expect(result.data.failed[0]?.index).toBe(1);
  });

  it("pairs name with id in each succeeded value (#594)", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "Stale work" });
    const id2 = await adapter.createTask({ name: "Side track" });
    const result = await handleTaskBatchDrop({ items: [{ id: id1 }, { id: id2 }] }, ctx);
    expect(result.data.dropped[0]?.value).toEqual({ id: id1, name: "Stale work" });
    expect(result.data.dropped[1]?.value).toEqual({ id: id2, name: "Side track" });
  });

  it("sets syncPending=true in meta when at least one task dropped", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "To Drop" });

    const result = await handleTaskBatchDrop({ items: [{ id }] }, ctx);

    expect(result.meta.syncPending).toBe(true);
  });

  it("sets syncPending=false in meta when all items fail", async () => {
    const { ctx } = makeCtx();

    const result = await handleTaskBatchDrop({ items: [{ id: "no-such-id" as never }] }, ctx);

    expect(result.data.dropped).toHaveLength(0);
    expect(result.data.failed).toHaveLength(1);
    expect(result.meta.syncPending).toBe(false);
  });

  it("preserves per-index positions in mixed success/failure", async () => {
    const { ctx, adapter } = makeCtx();
    const id0 = await adapter.createTask({ name: "T0" });
    const id2 = await adapter.createTask({ name: "T2" });

    const result = await handleTaskBatchDrop(
      { items: [{ id: id0 }, { id: "missing" as typeof id0 }, { id: id2 }] },
      ctx,
    );

    expect(result.data.dropped.map((d) => d.index)).toEqual([0, 2]);
    expect(result.data.failed.map((f) => f.index)).toEqual([1]);
  });
});
