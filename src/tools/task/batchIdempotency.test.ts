/**
 * Cross-cutting idempotency-key tests for the task batch mutation tools (#980).
 *
 * Per-tool unit tests already cover happy/failure paths. This file proves
 * that every batch handler honours the standard `idempotency_key` contract:
 * (a) same key → cached replay with `meta.idempotentReplay = true`;
 * (b) different keys → independent fresh executions.
 *
 * Schema-level checks (key length bounds, etc.) are skipped here — the
 * field comes from a shared idempotency-store wrapper whose own tests
 * (`src/server/idempotencyStore.test.ts`) cover those.
 *
 * @see docs/idempotency.md — the contract
 * @see #980 — this issue
 * @see #984 — companion adoption (decision_record + note_append)
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { IdempotencyStore } from "../../server/idempotencyStore.js";
import { handleTaskBatchAssign } from "./batchAssign.js";
import { handleTaskBatchComplete } from "./batchComplete.js";
import { handleTaskBatchCreate } from "./batchCreate.js";
import { handleTaskBatchDelete } from "./batchDelete.js";
import { handleTaskBatchDrop } from "./batchDrop.js";
import { handleTaskBatchMove } from "./batchMove.js";
import { handleTaskBatchUncomplete } from "./batchUncomplete.js";
import { handleTaskBatchUndrop } from "./batchUndrop.js";

async function seed(adapter: InMemoryAdapter, n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(await adapter.createTask({ name: `t-${i}` }));
  }
  return ids;
}

function makeCtx() {
  const adapter = new InMemoryAdapter();
  const idempotencyStore = new IdempotencyStore();
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return {
    ctx: { adapter, makeMeta, idempotencyStore },
    adapter,
    idempotencyStore,
  };
}

describe("task_batch_create — idempotency", () => {
  it("replays on same key; runs fresh on different key", async () => {
    const { ctx, adapter } = makeCtx();

    const first = await handleTaskBatchCreate(
      { items: [{ name: "a" }, { name: "b" }], idempotency_key: "k-1" },
      ctx,
    );
    expect(first.data.created.length).toBe(2);
    expect(first.meta.idempotentReplay).toBeUndefined();
    const idsAfterFirst = (await adapter.listTasks({})).map((t) => t.id).sort();

    const second = await handleTaskBatchCreate(
      { items: [{ name: "c" }, { name: "d" }], idempotency_key: "k-1" },
      ctx,
    );
    expect(second.meta.idempotentReplay).toBe(true);
    // No new tasks were created.
    const idsAfterSecond = (await adapter.listTasks({})).map((t) => t.id).sort();
    expect(idsAfterSecond).toEqual(idsAfterFirst);

    // Different key → fresh run.
    const third = await handleTaskBatchCreate(
      { items: [{ name: "e" }], idempotency_key: "k-2" },
      ctx,
    );
    expect(third.meta.idempotentReplay).toBeUndefined();
    expect(third.data.created.length).toBe(1);
  });
});

describe("task_batch_delete — idempotency", () => {
  it("replays on same key; runs fresh on different key", async () => {
    const { ctx, adapter } = makeCtx();
    const ids = await seed(adapter, 3);

    const first = await handleTaskBatchDelete(
      { confirm: true, items: [{ id: ids[0] as never }], idempotency_key: "k-1" },
      ctx,
    );
    expect(first.data.deleted.length).toBe(1);
    expect(first.meta.idempotentReplay).toBeUndefined();
    const remainingAfterFirst = (await adapter.listTasks({})).length;

    const second = await handleTaskBatchDelete(
      { confirm: true, items: [{ id: ids[1] as never }], idempotency_key: "k-1" },
      ctx,
    );
    expect(second.meta.idempotentReplay).toBe(true);
    expect((await adapter.listTasks({})).length).toBe(remainingAfterFirst);

    const third = await handleTaskBatchDelete(
      { confirm: true, items: [{ id: ids[1] as never }], idempotency_key: "k-2" },
      ctx,
    );
    expect(third.meta.idempotentReplay).toBeUndefined();
  });
});

describe("task_batch_complete — idempotency", () => {
  it("replays on same key", async () => {
    const { ctx, adapter } = makeCtx();
    const ids = await seed(adapter, 2);

    const first = await handleTaskBatchComplete(
      { items: [{ id: ids[0] as never }], idempotency_key: "k-1" },
      ctx,
    );
    expect(first.meta.idempotentReplay).toBeUndefined();

    const second = await handleTaskBatchComplete(
      { items: [{ id: ids[1] as never }], idempotency_key: "k-1" },
      ctx,
    );
    expect(second.meta.idempotentReplay).toBe(true);
    expect((await adapter.getTask(ids[1] as never)).completed).toBe(false);
  });
});

describe("task_batch_uncomplete — idempotency", () => {
  it("replays on same key", async () => {
    const { ctx, adapter } = makeCtx();
    const ids = await seed(adapter, 2);
    await adapter.completeTask(ids[0] as never);
    await adapter.completeTask(ids[1] as never);

    const first = await handleTaskBatchUncomplete(
      { items: [{ id: ids[0] as never }], idempotency_key: "k-1" },
      ctx,
    );
    expect(first.meta.idempotentReplay).toBeUndefined();

    const second = await handleTaskBatchUncomplete(
      { items: [{ id: ids[1] as never }], idempotency_key: "k-1" },
      ctx,
    );
    expect(second.meta.idempotentReplay).toBe(true);
    // Second task remains completed because the second call was replayed.
    expect((await adapter.getTask(ids[1] as never)).completed).toBe(true);
  });
});

describe("task_batch_drop — idempotency", () => {
  it("replays on same key", async () => {
    const { ctx, adapter } = makeCtx();
    const ids = await seed(adapter, 2);

    const first = await handleTaskBatchDrop(
      { items: [{ id: ids[0] as never }], idempotency_key: "k-1" },
      ctx,
    );
    expect(first.meta.idempotentReplay).toBeUndefined();

    const second = await handleTaskBatchDrop(
      { items: [{ id: ids[1] as never }], idempotency_key: "k-1" },
      ctx,
    );
    expect(second.meta.idempotentReplay).toBe(true);
    expect((await adapter.getTask(ids[1] as never)).dropped).toBe(false);
  });
});

describe("task_batch_undrop — idempotency", () => {
  it("replays on same key", async () => {
    const { ctx, adapter } = makeCtx();
    const ids = await seed(adapter, 2);
    await adapter.dropTask(ids[0] as never);
    await adapter.dropTask(ids[1] as never);

    const first = await handleTaskBatchUndrop(
      { items: [{ id: ids[0] as never }], idempotency_key: "k-1" },
      ctx,
    );
    expect(first.meta.idempotentReplay).toBeUndefined();

    const second = await handleTaskBatchUndrop(
      { items: [{ id: ids[1] as never }], idempotency_key: "k-1" },
      ctx,
    );
    expect(second.meta.idempotentReplay).toBe(true);
    expect((await adapter.getTask(ids[1] as never)).dropped).toBe(true);
  });
});

describe("task_batch_move — idempotency", () => {
  it("replays on same key", async () => {
    const { ctx, adapter } = makeCtx();
    const ids = await seed(adapter, 2);
    const dest = await adapter.createProject({ name: "dest" });

    const first = await handleTaskBatchMove(
      {
        items: [{ id: ids[0] as never, destination: { projectId: dest } }],
        idempotency_key: "k-1",
      },
      ctx,
    );
    expect(first.meta.idempotentReplay).toBeUndefined();

    const second = await handleTaskBatchMove(
      {
        items: [{ id: ids[1] as never, destination: { projectId: dest } }],
        idempotency_key: "k-1",
      },
      ctx,
    );
    expect(second.meta.idempotentReplay).toBe(true);
    expect((await adapter.getTask(ids[1] as never)).projectId).toBeNull();
  });
});

describe("task_batch_assign — idempotency", () => {
  it("replays on same key", async () => {
    const { ctx, adapter } = makeCtx();
    const ids = await seed(adapter, 2);

    const first = await handleTaskBatchAssign(
      {
        assignments: [{ taskId: ids[0] as never, flagged: true }],
        idempotency_key: "k-1",
      },
      ctx,
    );
    expect(first.meta.idempotentReplay).toBeUndefined();
    expect((await adapter.getTask(ids[0] as never)).flagged).toBe(true);

    const second = await handleTaskBatchAssign(
      {
        assignments: [{ taskId: ids[1] as never, flagged: true }],
        idempotency_key: "k-1",
      },
      ctx,
    );
    expect(second.meta.idempotentReplay).toBe(true);
    expect((await adapter.getTask(ids[1] as never)).flagged).toBe(false);
  });
});
