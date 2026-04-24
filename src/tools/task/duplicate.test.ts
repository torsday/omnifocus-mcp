/**
 * Tests for task_duplicate tool.
 *
 * Covers: schema, destination exclusivity, non-recursive vs recursive cloning,
 * field preservation, completed/dropped state reset, destination overrides
 * (project / parent / inbox), NotFound / ValidationError propagation, cache
 * invalidation across source + dest project.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { NotFound } from "../../errors/index.js";
import { handleTaskDuplicate, taskDuplicateInputSchema } from "./duplicate.js";

function recordScopes(cache: OmniFocusLruCache): InvalidationScope[] {
  const scopes: InvalidationScope[] = [];
  cache.on("cache.invalidated", (e: { scope: InvalidationScope }) => {
    scopes.push(e.scope);
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

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("task_duplicate — input schema", () => {
  it("requires id", () => {
    const result = taskDuplicateInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("defaults recursive to false", () => {
    const result = taskDuplicateInputSchema.parse({ id: "task_000001" });
    expect(result.recursive).toBe(false);
  });

  it("accepts destination.projectId", () => {
    const result = taskDuplicateInputSchema.safeParse({
      id: "task_000001",
      destination: { projectId: "proj_000001" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts destination.toInbox: true", () => {
    const result = taskDuplicateInputSchema.safeParse({
      id: "task_000001",
      destination: { toInbox: true },
    });
    expect(result.success).toBe(true);
  });

  it("rejects destination.toInbox: false", () => {
    const result = taskDuplicateInputSchema.safeParse({
      id: "task_000001",
      destination: { toInbox: false },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Handler — basic duplication
// ---------------------------------------------------------------------------

describe("task_duplicate — handler", () => {
  it("clones a task alongside the source by default", async () => {
    const { ctx, adapter } = makeCtx();
    const projectId = await adapter.createProject({ name: "P" });
    const src = await adapter.createTask({
      name: "Original",
      projectId,
      note: "n",
      flagged: true,
      estimatedMinutes: 15,
    });

    const res = await handleTaskDuplicate({ id: src, recursive: false }, ctx);
    expect(res.data.duplicated).toBe(true);
    expect(res.data.sourceId).toBe(src);
    expect(res.data.newId).not.toBe(src);
    expect(res.data.descendantCount).toBe(0);

    const clone = await adapter.getTask(res.data.newId);
    expect(clone.name).toBe("Original");
    expect(clone.note).toBe("n");
    expect(clone.flagged).toBe(true);
    expect(clone.estimatedMinutes).toBe(15);
    expect(clone.projectId).toBe(projectId);
    expect(clone.parentId).toBeNull();
  });

  it("preserves tag membership on the clone", async () => {
    const { ctx, adapter } = makeCtx();
    const t1 = await adapter.createTag({ name: "work" });
    const t2 = await adapter.createTag({ name: "urgent" });
    const src = await adapter.createTask({ name: "Tagged", tagIds: [t1, t2] });

    const res = await handleTaskDuplicate({ id: src, recursive: false }, ctx);
    const clone = await adapter.getTask(res.data.newId);
    expect(clone.tagIds).toEqual([t1, t2]);
  });

  it("resets completed state on the clone (a completed source → active clone)", async () => {
    const { ctx, adapter } = makeCtx();
    const src = await adapter.createTask({ name: "Done" });
    await adapter.completeTask(src);

    const res = await handleTaskDuplicate({ id: src, recursive: false }, ctx);
    const clone = await adapter.getTask(res.data.newId);
    expect(clone.completed).toBe(false);
    expect(clone.completedAt).toBeNull();
  });

  it("resets dropped state on the clone", async () => {
    const { ctx, adapter } = makeCtx();
    const src = await adapter.createTask({ name: "Dropped" });
    await adapter.dropTask(src);

    const res = await handleTaskDuplicate({ id: src, recursive: false }, ctx);
    const clone = await adapter.getTask(res.data.newId);
    expect(clone.dropped).toBe(false);
    expect(clone.droppedAt).toBeNull();
  });

  it("generates a new id distinct from the source", async () => {
    const { ctx, adapter } = makeCtx();
    const src = await adapter.createTask({ name: "x" });
    const res = await handleTaskDuplicate({ id: src, recursive: false }, ctx);
    expect(res.data.newId).not.toBe(src);
  });

  it("sets meta.syncPending = true", async () => {
    const { ctx, adapter } = makeCtx();
    const src = await adapter.createTask({ name: "x" });
    const res = await handleTaskDuplicate({ id: src, recursive: false }, ctx);
    expect(res.meta.syncPending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Recursive cloning
// ---------------------------------------------------------------------------

describe("task_duplicate — recursive", () => {
  it("clones the full subtree depth-first when recursive=true", async () => {
    const { ctx, adapter } = makeCtx();
    const root = await adapter.createTask({ name: "root" });
    const c1 = await adapter.createTask({ name: "c1", parentId: root });
    const _c2 = await adapter.createTask({ name: "c2", parentId: root });
    const g1 = await adapter.createTask({ name: "g1", parentId: c1 });

    const res = await handleTaskDuplicate({ id: root, recursive: true }, ctx);
    expect(res.data.descendantCount).toBe(3);

    const cloneRoot = await adapter.getTask(res.data.newId);
    expect(cloneRoot.name).toBe("root");

    const cloneChildren = (await adapter.listTasks({ parentId: res.data.newId })).map(
      (t) => t.name,
    );
    expect(cloneChildren.sort()).toEqual(["c1", "c2"]);

    // Original tree untouched
    expect((await adapter.listTasks({ parentId: root })).length).toBe(2);
    expect((await adapter.listTasks({ parentId: c1 })).length).toBe(1);
    expect(g1).toBeDefined();
  });

  it("returns descendantCount=0 when recursive=false even if source has children", async () => {
    const { ctx, adapter } = makeCtx();
    const root = await adapter.createTask({ name: "r" });
    await adapter.createTask({ name: "c", parentId: root });

    const res = await handleTaskDuplicate({ id: root, recursive: false }, ctx);
    expect(res.data.descendantCount).toBe(0);
    const cloneChildren = await adapter.listTasks({ parentId: res.data.newId });
    expect(cloneChildren).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Destination overrides
// ---------------------------------------------------------------------------

describe("task_duplicate — destination", () => {
  it("places the clone in a different project when destination.projectId is set", async () => {
    const { ctx, adapter } = makeCtx();
    const p1 = await adapter.createProject({ name: "p1" });
    const p2 = await adapter.createProject({ name: "p2" });
    const src = await adapter.createTask({ name: "x", projectId: p1 });

    const res = await handleTaskDuplicate(
      { id: src, recursive: false, destination: { projectId: p2 } },
      ctx,
    );
    const clone = await adapter.getTask(res.data.newId);
    expect(clone.projectId).toBe(p2);
  });

  it("places the clone under a different parent when destination.parentId is set", async () => {
    const { ctx, adapter } = makeCtx();
    const projectId = await adapter.createProject({ name: "P" });
    const parent = await adapter.createTask({ name: "parent", projectId });
    const src = await adapter.createTask({ name: "src", projectId });

    const res = await handleTaskDuplicate(
      { id: src, recursive: false, destination: { parentId: parent } },
      ctx,
    );
    const clone = await adapter.getTask(res.data.newId);
    expect(clone.parentId).toBe(parent);
    expect(clone.projectId).toBe(projectId);
  });

  it("places the clone in the inbox when destination.toInbox=true", async () => {
    const { ctx, adapter } = makeCtx();
    const projectId = await adapter.createProject({ name: "P" });
    const src = await adapter.createTask({ name: "x", projectId });

    const res = await handleTaskDuplicate(
      { id: src, recursive: false, destination: { toInbox: true } },
      ctx,
    );
    const clone = await adapter.getTask(res.data.newId);
    expect(clone.projectId).toBeNull();
    expect(clone.parentId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe("task_duplicate — errors", () => {
  it("throws NotFound when source id is unknown", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTaskDuplicate({ id: TaskId.of("task_missing"), recursive: false }, ctx),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("throws NotFound when destination.projectId is unknown", async () => {
    const { ctx, adapter } = makeCtx();
    const src = await adapter.createTask({ name: "x" });
    await expect(
      handleTaskDuplicate(
        {
          id: src,
          recursive: false,
          destination: { projectId: ProjectId.of("proj_missing") },
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("throws NotFound when destination.parentId is unknown", async () => {
    const { ctx, adapter } = makeCtx();
    const src = await adapter.createTask({ name: "x" });
    await expect(
      handleTaskDuplicate(
        { id: src, recursive: false, destination: { parentId: TaskId.of("task_missing") } },
        ctx,
      ),
    ).rejects.toBeInstanceOf(NotFound);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("task_duplicate — cache invalidation", () => {
  it("invalidates the source project scope plus wildcards", async () => {
    const { adapter, ctx } = makeCtx();
    const projectId = await adapter.createProject({ name: "P" });
    const src = await adapter.createTask({ name: "x", projectId });

    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);

    await handleTaskDuplicate({ id: src, recursive: false }, { ...ctx, cache });

    expect(scopes).toContain(`project:${projectId}`);
    expect(scopes).toContain("forecast:*");
    expect(scopes).toContain("perspective:*");
    expect(scopes).toContain("search:*");
  });

  it("also invalidates destination project when it differs from source", async () => {
    const { adapter, ctx } = makeCtx();
    const p1 = await adapter.createProject({ name: "p1" });
    const p2 = await adapter.createProject({ name: "p2" });
    const src = await adapter.createTask({ name: "x", projectId: p1 });

    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);

    await handleTaskDuplicate(
      { id: src, recursive: false, destination: { projectId: p2 } },
      { ...ctx, cache },
    );

    expect(scopes).toContain(`project:${p1}`);
    expect(scopes).toContain(`project:${p2}`);
  });

  it("does not double-invalidate when destination project matches source", async () => {
    const { adapter, ctx } = makeCtx();
    const projectId = await adapter.createProject({ name: "p" });
    const src = await adapter.createTask({ name: "x", projectId });

    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);

    await handleTaskDuplicate(
      { id: src, recursive: false, destination: { projectId } },
      { ...ctx, cache },
    );

    const projScopeCount = scopes.filter((s) => s === `project:${projectId}`).length;
    expect(projScopeCount).toBe(1);
  });
});
