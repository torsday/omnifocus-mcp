/**
 * Tests for task_delete tool.
 *
 * Covers: schema validation, successful deletion, NotFound for unknown ID,
 * idempotency (double-delete raises NotFound), and response shape.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskDelete, taskDeleteInputSchema } from "./delete.js";

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
