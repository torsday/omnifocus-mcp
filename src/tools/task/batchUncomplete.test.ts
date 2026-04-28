/**
 * Tests for task_batch_uncomplete tool.
 *
 * Covers: schema validation, full success, partial failure (missing ID),
 * empty input rejection, completed→incomplete state verified, syncPending flag.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskBatchUncomplete, taskBatchUncompleteInputSchema } from "./batchUncomplete.js";

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

describe("task_batch_uncomplete — input schema", () => {
  it("rejects empty items array", () => {
    expect(() => taskBatchUncompleteInputSchema.parse({ items: [] })).toThrow();
  });

  it("accepts a valid single item", () => {
    const result = taskBatchUncompleteInputSchema.parse({ items: [{ id: "abc" }] });
    expect(result.items).toHaveLength(1);
  });

  it("accepts multiple items", () => {
    const result = taskBatchUncompleteInputSchema.parse({
      items: [{ id: "abc" }, { id: "def" }],
    });
    expect(result.items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("task_batch_uncomplete — handler", () => {
  it("uncompletes all tasks and returns uncompleted[] on full success", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "Task A" });
    const id2 = await adapter.createTask({ name: "Task B" });
    await adapter.completeTask(id1);
    await adapter.completeTask(id2);

    const result = await handleTaskBatchUncomplete({ items: [{ id: id1 }, { id: id2 }] }, ctx);

    expect(result.data.uncompleted).toHaveLength(2);
    expect(result.data.failed).toHaveLength(0);
    // Tasks should be marked incomplete again
    const t1 = await adapter.getTask(id1);
    const t2 = await adapter.getTask(id2);
    expect(t1.completed).toBe(false);
    expect(t2.completed).toBe(false);
  });

  it("reports partial failure when one ID does not exist", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "Real Task" });
    await adapter.completeTask(id1);
    const missing = "nonexistent-id" as typeof id1;

    const result = await handleTaskBatchUncomplete({ items: [{ id: id1 }, { id: missing }] }, ctx);

    expect(result.data.uncompleted).toHaveLength(1);
    expect(result.data.uncompleted[0]?.index).toBe(0);
    expect(result.data.failed).toHaveLength(1);
    expect(result.data.failed[0]?.index).toBe(1);
  });

  it("pairs name with id in each succeeded value (#594)", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "Reopen me" });
    const id2 = await adapter.createTask({ name: "And me" });
    await adapter.completeTask(id1);
    await adapter.completeTask(id2);
    const result = await handleTaskBatchUncomplete({ items: [{ id: id1 }, { id: id2 }] }, ctx);
    expect(result.data.uncompleted[0]?.value).toEqual({ id: id1, name: "Reopen me" });
    expect(result.data.uncompleted[1]?.value).toEqual({ id: id2, name: "And me" });
  });

  it("sets syncPending=true in meta when at least one task uncompleted", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "To Uncomplete" });
    await adapter.completeTask(id);

    const result = await handleTaskBatchUncomplete({ items: [{ id }] }, ctx);

    expect(result.meta.syncPending).toBe(true);
  });

  it("sets syncPending=false in meta when all items fail", async () => {
    const { ctx } = makeCtx();

    const result = await handleTaskBatchUncomplete({ items: [{ id: "no-such-id" as never }] }, ctx);

    expect(result.data.uncompleted).toHaveLength(0);
    expect(result.data.failed).toHaveLength(1);
    expect(result.meta.syncPending).toBe(false);
  });

  it("preserves per-index positions in mixed success/failure", async () => {
    const { ctx, adapter } = makeCtx();
    const id0 = await adapter.createTask({ name: "T0" });
    const id2 = await adapter.createTask({ name: "T2" });
    await adapter.completeTask(id0);
    await adapter.completeTask(id2);

    const result = await handleTaskBatchUncomplete(
      { items: [{ id: id0 }, { id: "missing" as typeof id0 }, { id: id2 }] },
      ctx,
    );

    expect(result.data.uncompleted.map((d) => d.index)).toEqual([0, 2]);
    expect(result.data.failed.map((f) => f.index)).toEqual([1]);
  });

  it("uncompleting an already-incomplete task still succeeds (idempotent)", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Active Task" });
    // Task is not completed — uncomplete is a valid no-op

    const result = await handleTaskBatchUncomplete({ items: [{ id }] }, ctx);

    expect(result.data.uncompleted).toHaveLength(1);
    expect(result.data.failed).toHaveLength(0);
    const task = await adapter.getTask(id);
    expect(task.completed).toBe(false);
  });
});
