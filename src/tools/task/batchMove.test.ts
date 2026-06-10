/**
 * Tests for task_batch_move tool.
 *
 * Covers: schema validation (mutual exclusivity, min-1), full success,
 * partial failure, projectId/parentId/inbox destinations, syncPending flag,
 * per-index preservation.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ProjectId } from "../../domain/ids.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskBatchMove, taskBatchMoveInputSchema } from "./batchMove.js";

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

describe("task_batch_move — input schema", () => {
  it("rejects empty items array", () => {
    expect(() => taskBatchMoveInputSchema.parse({ items: [] })).toThrow();
  });

  it("accepts projectId-only destination", () => {
    const result = taskBatchMoveInputSchema.parse({
      items: [{ id: "abc", destination: { projectId: "proj_001" } }],
    });
    expect(result.items).toHaveLength(1);
  });

  it("accepts parentId-only destination", () => {
    const result = taskBatchMoveInputSchema.parse({
      items: [{ id: "abc", destination: { parentId: "task_001" } }],
    });
    expect(result.items).toHaveLength(1);
  });

  it("accepts inbox destination (neither projectId nor parentId)", () => {
    const result = taskBatchMoveInputSchema.parse({
      items: [{ id: "abc", destination: {} }],
    });
    expect(result.items).toHaveLength(1);
  });

  it("rejects when both projectId and parentId are provided", () => {
    expect(() =>
      taskBatchMoveInputSchema.parse({
        items: [{ id: "abc", destination: { projectId: "proj_001", parentId: "task_001" } }],
      }),
    ).toThrow();
  });

  it("accepts multiple items with mixed destinations", () => {
    const result = taskBatchMoveInputSchema.parse({
      items: [
        { id: "abc", destination: { projectId: "proj_001" } },
        { id: "def", destination: { parentId: "task_001" } },
        { id: "ghi", destination: {} },
      ],
    });
    expect(result.items).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("task_batch_move — handler", () => {
  it("moves tasks to a project and returns moved[] on full success", async () => {
    const { ctx, adapter } = makeCtx();
    const project = await adapter.createProject({ name: "Target Project" });
    const id1 = await adapter.createTask({ name: "Task A" });
    const id2 = await adapter.createTask({ name: "Task B" });

    const result = await handleTaskBatchMove(
      {
        items: [
          { id: id1, destination: { projectId: project } },
          { id: id2, destination: { projectId: project } },
        ],
      },
      ctx,
    );

    expect(result.data.moved).toHaveLength(2);
    expect(result.data.failed).toHaveLength(0);
  });

  it("reports partial failure when one ID does not exist", async () => {
    const { ctx, adapter } = makeCtx();
    const project = await adapter.createProject({ name: "Target" });
    const id1 = await adapter.createTask({ name: "Real Task" });
    const missing = "nonexistent-id" as typeof id1;

    const result = await handleTaskBatchMove(
      {
        items: [
          { id: id1, destination: { projectId: project } },
          { id: missing, destination: { projectId: project } },
        ],
      },
      ctx,
    );

    expect(result.data.moved).toHaveLength(1);
    expect(result.data.moved[0]?.index).toBe(0);
    expect(result.data.failed).toHaveLength(1);
    expect(result.data.failed[0]?.index).toBe(1);
  });

  it("pairs name with id in each succeeded value (#597)", async () => {
    const { ctx, adapter } = makeCtx();
    const project = await adapter.createProject({ name: "P" });
    const id1 = await adapter.createTask({ name: "Roaming A" });
    const id2 = await adapter.createTask({ name: "Roaming B" });
    const result = await handleTaskBatchMove(
      {
        items: [
          { id: id1, destination: { projectId: project } },
          { id: id2, destination: { projectId: project } },
        ],
      },
      ctx,
    );
    expect(result.data.moved[0]?.value).toEqual({ id: id1, name: "Roaming A" });
    expect(result.data.moved[1]?.value).toEqual({ id: id2, name: "Roaming B" });
  });

  it("sets syncPending=true when at least one task moved", async () => {
    const { ctx, adapter } = makeCtx();
    const project = await adapter.createProject({ name: "P" });
    const id = await adapter.createTask({ name: "T" });

    const result = await handleTaskBatchMove(
      { items: [{ id, destination: { projectId: project } }] },
      ctx,
    );

    expect(result.meta.syncPending).toBe(true);
  });

  it("sets syncPending=false when all items fail", async () => {
    const { ctx } = makeCtx();

    const result = await handleTaskBatchMove(
      { items: [{ id: "no-such-id" as never, destination: {} }] },
      ctx,
    );

    expect(result.data.moved).toHaveLength(0);
    expect(result.data.failed).toHaveLength(1);
    expect(result.meta.syncPending).toBe(false);
  });

  it("preserves per-index positions in mixed success/failure", async () => {
    const { ctx, adapter } = makeCtx();
    const project = await adapter.createProject({ name: "P" });
    const id0 = await adapter.createTask({ name: "T0" });
    const id2 = await adapter.createTask({ name: "T2" });

    const result = await handleTaskBatchMove(
      {
        items: [
          { id: id0, destination: { projectId: project } },
          { id: "missing" as typeof id0, destination: { projectId: project } },
          { id: id2, destination: { projectId: project } },
        ],
      },
      ctx,
    );

    expect(result.data.moved.map((m) => m.index)).toEqual([0, 2]);
    expect(result.data.failed.map((f) => f.index)).toEqual([1]);
  });

  it("moves task to inbox (no destination) succeeds", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Inbox Task" });

    const result = await handleTaskBatchMove({ items: [{ id, destination: {} }] }, ctx);

    expect(result.data.moved).toHaveLength(1);
    expect(result.data.failed).toHaveLength(0);
  });

  it("moves task under a parent task", async () => {
    const { ctx, adapter } = makeCtx();
    const parent = await adapter.createTask({ name: "Parent" });
    const child = await adapter.createTask({ name: "Child" });

    const result = await handleTaskBatchMove(
      { items: [{ id: child, destination: { parentId: parent } }] },
      ctx,
    );

    expect(result.data.moved).toHaveLength(1);
    expect(result.data.failed).toHaveLength(0);
  });

  it("reports failed project destination when project does not exist", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    const badProject = "no-such-project" as ProjectId;

    const result = await handleTaskBatchMove(
      { items: [{ id, destination: { projectId: badProject } }] },
      ctx,
    );

    expect(result.data.moved).toHaveLength(0);
    expect(result.data.failed).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation (docs/cache-invalidation.md)
// ---------------------------------------------------------------------------

describe("task_batch_move — cache invalidation", () => {
  it("emits both the source and destination project scopes", async () => {
    const { ctx, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes: InvalidationScope[] = [];
    cache.on("cache.invalidated", (e: { scopes: InvalidationScope[] }) => {
      scopes.push(...e.scopes);
    });
    const projectA = await adapter.createProject({ name: "A" });
    const projectB = await adapter.createProject({ name: "B" });
    const id = await adapter.createTask({ name: "T", projectId: projectA });

    await handleTaskBatchMove(
      { items: [{ id, destination: { projectId: projectB } }] },
      { ...ctx, cache },
    );

    expect(scopes).toContain(`task:${id}`);
    expect(scopes).toContain(`project:${projectA}`);
    expect(scopes).toContain(`project:${projectB}`);
  });
});
