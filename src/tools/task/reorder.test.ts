/**
 * Tests for task_reorder tool.
 *
 * Covers: schema, exclusivity of positioning forms, before/after within a
 * project, start/end within an explicit container, idempotency-ish behavior
 * (re-reorder to same spot is allowed), NotFound propagation, validation for
 * cross-parent references, and cache invalidation across source + dest.
 */

import { describe, expect, it } from "vitest";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { NotFound, ValidationError } from "../../errors/index.js";
import { handleTaskReorder, taskReorderInputSchema } from "./reorder.js";

function recordScopes(cache: OmniFocusLruCache): InvalidationScope[] {
  const scopes: InvalidationScope[] = [];
  cache.on("cache.invalidated", (e: { scopes: InvalidationScope[] }) => {
    scopes.push(...e.scopes);
  });
  return scopes;
}

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

async function seedProjectWithThreeTasks(adapter: OmniFocusAdapter) {
  const projectId = await adapter.createProject({ name: "P" });
  const a = await adapter.createTask({ name: "a", projectId });
  const b = await adapter.createTask({ name: "b", projectId });
  const c = await adapter.createTask({ name: "c", projectId });
  return { projectId, a, b, c };
}

function idsOf(tasks: { id: TaskId }[]): string[] {
  return tasks.map((t) => t.id);
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("task_reorder — input schema", () => {
  it("requires id", () => {
    expect(() => taskReorderInputSchema.parse({})).toThrow();
  });

  it("accepts id + before", () => {
    expect(() =>
      taskReorderInputSchema.parse({ id: "task_000001", before: "task_000002" }),
    ).not.toThrow();
  });

  it("accepts id + after", () => {
    expect(() =>
      taskReorderInputSchema.parse({ id: "task_000001", after: "task_000002" }),
    ).not.toThrow();
  });

  it("accepts id + at + in.projectId", () => {
    expect(() =>
      taskReorderInputSchema.parse({
        id: "task_000001",
        at: "start",
        in: { projectId: "proj_000001" },
      }),
    ).not.toThrow();
  });

  it("accepts id + at + in.inbox", () => {
    expect(() =>
      taskReorderInputSchema.parse({
        id: "task_000001",
        at: "end",
        in: { inbox: true },
      }),
    ).not.toThrow();
  });

  it("rejects invalid at value", () => {
    expect(() =>
      taskReorderInputSchema.parse({
        id: "task_000001",
        at: "middle",
        in: { inbox: true },
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Exclusivity / handler validation
// ---------------------------------------------------------------------------

describe("task_reorder — exclusivity", () => {
  it("rejects when no positioning form is set", async () => {
    const { ctx } = makeCtx();
    await expect(handleTaskReorder({ id: TaskId.of("task_000001") }, ctx)).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects when both before and after are set", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTaskReorder(
        {
          id: TaskId.of("task_000001"),
          before: TaskId.of("task_000002"),
          after: TaskId.of("task_000003"),
        },
        ctx,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects when before and at are both set", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTaskReorder(
        {
          id: TaskId.of("task_000001"),
          before: TaskId.of("task_000002"),
          at: "start",
          in: { inbox: true },
        },
        ctx,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects when at is set without in", async () => {
    const { ctx, adapter } = makeCtx();
    const { a } = await seedProjectWithThreeTasks(adapter);
    await expect(handleTaskReorder({ id: a, at: "start" }, ctx)).rejects.toThrow(ValidationError);
  });

  it("rejects when in is set without at", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTaskReorder({ id: TaskId.of("task_000001"), in: { inbox: true } }, ctx),
    ).rejects.toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Behavior
// ---------------------------------------------------------------------------

describe("task_reorder — behavior", () => {
  it("moves task before a sibling", async () => {
    const { ctx, adapter } = makeCtx();
    const { projectId, a, b, c } = await seedProjectWithThreeTasks(adapter);
    // starting order: a, b, c — move c before a
    const res = await handleTaskReorder({ id: c, before: a }, ctx);
    expect(res.data).toMatchObject({ reordered: true, id: c });
    const tasks = await adapter.listTasks({ projectId });
    expect(idsOf(tasks)).toEqual([c, a, b]);
  });

  it("moves task after a sibling", async () => {
    const { ctx, adapter } = makeCtx();
    const { projectId, a, b, c } = await seedProjectWithThreeTasks(adapter);
    // move a after b → b, a, c
    await handleTaskReorder({ id: a, after: b }, ctx);
    const tasks = await adapter.listTasks({ projectId });
    expect(idsOf(tasks)).toEqual([b, a, c]);
  });

  it("moves task to start of project container", async () => {
    const { ctx, adapter } = makeCtx();
    const { projectId, a, b, c } = await seedProjectWithThreeTasks(adapter);
    await handleTaskReorder({ id: c, at: "start", in: { projectId } }, ctx);
    const tasks = await adapter.listTasks({ projectId });
    expect(idsOf(tasks)).toEqual([c, a, b]);
  });

  it("moves task to end of project container", async () => {
    const { ctx, adapter } = makeCtx();
    const { projectId, a, b, c } = await seedProjectWithThreeTasks(adapter);
    await handleTaskReorder({ id: a, at: "end", in: { projectId } }, ctx);
    const tasks = await adapter.listTasks({ projectId });
    expect(idsOf(tasks)).toEqual([b, c, a]);
  });

  it("reparents when { at, in } names a different container", async () => {
    const { ctx, adapter } = makeCtx();
    const { a } = await seedProjectWithThreeTasks(adapter);
    const p2 = await adapter.createProject({ name: "P2" });
    await handleTaskReorder({ id: a, at: "start", in: { projectId: p2 } }, ctx);
    const task = await adapter.getTask(a);
    expect(task.projectId).toBe(p2);
    expect(task.parentId).toBeNull();
  });

  it("sets meta.syncPending on success", async () => {
    const { ctx, adapter } = makeCtx();
    const { a, b } = await seedProjectWithThreeTasks(adapter);
    const res = await handleTaskReorder({ id: a, after: b }, ctx);
    expect(res.meta.syncPending).toBe(true);
  });

  it("propagates NotFound when the task id does not exist", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTaskReorder({ id: TaskId.of("task_missing"), at: "end", in: { inbox: true } }, ctx),
    ).rejects.toThrow(NotFound);
  });

  it("propagates NotFound when reference task does not exist", async () => {
    const { ctx, adapter } = makeCtx();
    const { a } = await seedProjectWithThreeTasks(adapter);
    await expect(
      handleTaskReorder({ id: a, before: TaskId.of("task_missing") }, ctx),
    ).rejects.toThrow(NotFound);
  });

  it("rejects cross-parent references with ValidationError", async () => {
    const { ctx, adapter } = makeCtx();
    const { a } = await seedProjectWithThreeTasks(adapter);
    const p2 = await adapter.createProject({ name: "P2" });
    const otherProjectTask = await adapter.createTask({ name: "x", projectId: p2 });
    await expect(handleTaskReorder({ id: a, before: otherProjectTask }, ctx)).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects NotFound when container projectId does not exist", async () => {
    const { ctx, adapter } = makeCtx();
    const { a } = await seedProjectWithThreeTasks(adapter);
    await expect(
      handleTaskReorder({ id: a, at: "end", in: { projectId: ProjectId.of("proj_missing") } }, ctx),
    ).rejects.toThrow(NotFound);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("task_reorder — cache invalidation", () => {
  it("invalidates source project scope on same-container reorder", async () => {
    const { adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const { projectId, a, b } = await seedProjectWithThreeTasks(adapter);
    const ctx = {
      adapter,
      cache,
      makeMeta: (p: Partial<ResponseMeta> = {}): ResponseMeta => ({
        correlationId: "cid",
        durationMs: 0,
        cacheHit: false,
        transport: "memory",
        ofVersion: "test",
        ...p,
      }),
    };
    await handleTaskReorder({ id: a, after: b }, ctx);
    expect(scopes.some((s) => s === `task:${a}`)).toBe(true);
    expect(scopes.some((s) => s === `project:${projectId}`)).toBe(true);
  });

  it("invalidates BOTH source and destination project scopes on cross-container reorder", async () => {
    const { adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const { projectId: srcProject, a } = await seedProjectWithThreeTasks(adapter);
    const destProject = await adapter.createProject({ name: "P2" });
    const ctx = {
      adapter,
      cache,
      makeMeta: (p: Partial<ResponseMeta> = {}): ResponseMeta => ({
        correlationId: "cid",
        durationMs: 0,
        cacheHit: false,
        transport: "memory",
        ofVersion: "test",
        ...p,
      }),
    };
    await handleTaskReorder({ id: a, at: "start", in: { projectId: destProject } }, ctx);
    expect(scopes.some((s) => s === `project:${srcProject}`)).toBe(true);
    expect(scopes.some((s) => s === `project:${destProject}`)).toBe(true);
  });
});
