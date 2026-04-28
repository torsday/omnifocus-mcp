/**
 * Tests for task_batch_create / task_batch_update / task_batch_complete.
 *
 * Covers:
 *  - Atomic validation: any schema failure rejects the whole batch.
 *  - Best-effort execution: per-item failures isolate from successes.
 *  - Envelope key rename: adapter's `succeeded` surfaces as
 *    `created` / `updated` / `completed` in the tool response.
 *  - syncPending: only true when at least one item succeeded.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import type { ProjectId, TaskId } from "../../domain/ids.js";
import type { ResponseMeta, ToolEnvelope } from "../../envelope/index.js";
import { handleTaskBatchComplete, taskBatchCompleteInputBaseSchema } from "./batchComplete.js";
import { handleTaskBatchCreate, taskBatchCreateInputBaseSchema } from "./batchCreate.js";
import { handleTaskBatchUpdate, taskBatchUpdateInputBaseSchema } from "./batchUpdate.js";

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

function okData<T>(env: ToolEnvelope<T>): T {
  if (!("data" in env)) throw new Error("expected ok envelope");
  return env.data;
}

// ---------------------------------------------------------------------------
// task_batch_create
// ---------------------------------------------------------------------------

describe("task_batch_create — schema", () => {
  it("requires a non-empty items array", () => {
    expect(() => taskBatchCreateInputBaseSchema.parse({ items: [] })).toThrow();
  });

  it("rejects projectId + parentTaskId together (atomic)", () => {
    expect(() =>
      taskBatchCreateInputBaseSchema.parse({
        items: [
          { name: "a" },
          { name: "b", projectId: "proj_000001", parentTaskId: "task_000001" },
        ],
      }),
    ).toThrow();
  });

  it("accepts a well-formed batch", () => {
    const parsed = taskBatchCreateInputBaseSchema.parse({
      items: [{ name: "a" }, { name: "b", flagged: true }],
    });
    expect(parsed.items).toHaveLength(2);
  });
});

describe("task_batch_create — handler", () => {
  it("creates all items and reports ids under `created`", async () => {
    const { ctx } = makeCtx();
    const env = await handleTaskBatchCreate(
      { items: [{ name: "a" }, { name: "b" }, { name: "c" }] },
      ctx,
    );
    const data = okData(env);
    expect(data.created).toHaveLength(3);
    expect(data.failed).toHaveLength(0);
    expect(data.created.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(env.meta.syncPending).toBe(true);
  });

  it("isolates per-item failures while succeeding others", async () => {
    const { ctx } = makeCtx();
    const env = await handleTaskBatchCreate(
      {
        items: [
          { name: "ok" },
          // Nonexistent project — adapter rejects just this one.
          { name: "bad", projectId: "proj_999999" as ProjectId },
          { name: "ok2" },
        ],
      },
      ctx,
    );
    const data = okData(env);
    expect(data.created.map((s) => s.index).sort()).toEqual([0, 2]);
    expect(data.failed).toHaveLength(1);
    expect(data.failed[0]?.index).toBe(1);
    expect(env.meta.syncPending).toBe(true);
  });

  it("syncPending = false when every item fails", async () => {
    const { ctx } = makeCtx();
    const env = await handleTaskBatchCreate(
      { items: [{ name: "bad", projectId: "proj_999999" as ProjectId }] },
      ctx,
    );
    expect(env.meta.syncPending).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// task_batch_update
// ---------------------------------------------------------------------------

describe("task_batch_update — schema", () => {
  it("rejects empty patch objects", () => {
    expect(() =>
      taskBatchUpdateInputBaseSchema.parse({
        items: [{ id: "task_000001", patch: {} }],
      }),
    ).toThrow();
  });

  it("accepts minimal patches", () => {
    const parsed = taskBatchUpdateInputBaseSchema.parse({
      items: [{ id: "task_000001", patch: { name: "x" } }],
    });
    expect(parsed.items[0]?.patch.name).toBe("x");
  });
});

describe("task_batch_update — handler", () => {
  it("patches each task and surfaces under `updated`", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "a" });
    const id2 = await adapter.createTask({ name: "b" });
    const env = await handleTaskBatchUpdate(
      {
        items: [
          { id: id1, patch: { name: "a2" } },
          { id: id2, patch: { flagged: true } },
        ],
      },
      ctx,
    );
    const data = okData(env);
    expect(data.updated).toHaveLength(2);
    expect(data.failed).toHaveLength(0);
    const t1 = await adapter.getTask(id1);
    const t2 = await adapter.getTask(id2);
    expect(t1.name).toBe("a2");
    expect(t2.flagged).toBe(true);
  });

  it("isolates failures for unknown ids", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "real" });
    const env = await handleTaskBatchUpdate(
      {
        items: [
          { id, patch: { name: "renamed" } },
          { id: "task_999999" as TaskId, patch: { name: "nope" } },
        ],
      },
      ctx,
    );
    const data = okData(env);
    expect(data.updated.map((s) => s.index)).toEqual([0]);
    expect(data.failed.map((f) => f.index)).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// task_batch_complete
// ---------------------------------------------------------------------------

describe("task_batch_complete — schema", () => {
  it("requires a non-empty items array", () => {
    expect(() => taskBatchCompleteInputBaseSchema.parse({ items: [] })).toThrow();
  });

  it("accepts id with optional at", () => {
    const parsed = taskBatchCompleteInputBaseSchema.parse({
      items: [{ id: "task_000001" }, { id: "task_000002", at: "2026-04-24T12:00:00+00:00" }],
    });
    expect(parsed.items).toHaveLength(2);
  });

  it("rejects `at` without timezone offset", () => {
    expect(() =>
      taskBatchCompleteInputBaseSchema.parse({
        items: [{ id: "task_000001", at: "2026-04-24T12:00:00" }],
      }),
    ).toThrow();
  });
});

describe("task_batch_complete — handler", () => {
  it("completes each task and surfaces under `completed`", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "a" });
    const id2 = await adapter.createTask({ name: "b" });
    const env = await handleTaskBatchComplete({ items: [{ id: id1 }, { id: id2 }] }, ctx);
    const data = okData(env);
    expect(data.completed).toHaveLength(2);
    expect(data.failed).toHaveLength(0);
    const t1 = await adapter.getTask(id1);
    expect(t1.completed).toBe(true);
  });

  it("isolates failures for unknown ids", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "real" });
    const env = await handleTaskBatchComplete(
      {
        items: [{ id: "task_999999" as TaskId }, { id }],
      },
      ctx,
    );
    const data = okData(env);
    expect(data.completed.map((s) => s.index)).toEqual([1]);
    expect(data.failed.map((f) => f.index)).toEqual([0]);
  });

  it("pairs name with id in each succeeded value (#594)", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "Send invoice" });
    const id2 = await adapter.createTask({ name: "Pay rent" });
    const env = await handleTaskBatchComplete({ items: [{ id: id1 }, { id: id2 }] }, ctx);
    const data = okData(env);
    expect(data.completed[0]?.value).toEqual({ id: id1, name: "Send invoice" });
    expect(data.completed[1]?.value).toEqual({ id: id2, name: "Pay rent" });
  });
});

// ---------------------------------------------------------------------------
// Contract: single adapter call per batch (one JXA round trip)
// ---------------------------------------------------------------------------

describe("batch tools — one adapter call per batch", () => {
  it("task_batch_create invokes adapter.batchCreateTasks exactly once", async () => {
    const { adapter: real } = makeCtx();
    let calls = 0;
    const spy: OmniFocusAdapter = new Proxy(real, {
      get(target, prop, recv) {
        if (prop === "batchCreateTasks") {
          return async (...args: Parameters<OmniFocusAdapter["batchCreateTasks"]>) => {
            calls++;
            return real.batchCreateTasks(...args);
          };
        }
        return Reflect.get(target, prop, recv);
      },
    });
    const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
      correlationId: "t",
      durationMs: 0,
      cacheHit: false,
      transport: "memory",
      ofVersion: "test",
      ...partial,
    });
    await handleTaskBatchCreate(
      { items: [{ name: "a" }, { name: "b" }, { name: "c" }] },
      { adapter: spy, makeMeta },
    );
    expect(calls).toBe(1);
  });
});
