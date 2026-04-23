/**
 * Tests for task_move tool.
 *
 * Covers: schema validation, exclusivity of destination fields, successful
 * move into project / under parent / to inbox, idempotency (noChange),
 * NotFound propagation, and cache invalidation scopes for both the source
 * and destination projects.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { NotFound, ValidationError } from "../../errors/index.js";
import { handleTaskMove, taskMoveInputSchema } from "./move.js";

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

describe("task_move — input schema", () => {
  it("requires id", () => {
    expect(() => taskMoveInputSchema.parse({})).toThrow();
  });

  it("accepts id + projectId", () => {
    expect(() =>
      taskMoveInputSchema.parse({ id: "task_000001", projectId: "proj_000001" }),
    ).not.toThrow();
  });

  it("accepts id + parentId", () => {
    expect(() =>
      taskMoveInputSchema.parse({ id: "task_000001", parentId: "task_000002" }),
    ).not.toThrow();
  });

  it("accepts id + toInbox: true", () => {
    expect(() => taskMoveInputSchema.parse({ id: "task_000001", toInbox: true })).not.toThrow();
  });

  it("rejects toInbox: false (must be literal true or omitted)", () => {
    expect(() => taskMoveInputSchema.parse({ id: "task_000001", toInbox: false })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Destination exclusivity (handler-level business rule)
// ---------------------------------------------------------------------------

describe("task_move — destination exclusivity", () => {
  it("rejects when no destination is set", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "t" });
    await expect(handleTaskMove({ id }, ctx)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects when projectId + parentId are both set", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "t" });
    const projectId = await adapter.createProject({ name: "p" });
    const parentId = await adapter.createTask({ name: "parent" });
    await expect(handleTaskMove({ id, projectId, parentId }, ctx)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects when projectId + toInbox are both set", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "t" });
    const projectId = await adapter.createProject({ name: "p" });
    await expect(handleTaskMove({ id, projectId, toInbox: true }, ctx)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("task_move — handler", () => {
  it("moves an inbox task into a project", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "t" });
    const projectId = await adapter.createProject({ name: "p" });

    const envelope = await handleTaskMove({ id, projectId }, ctx);

    expect("moved" in envelope.data && envelope.data.moved).toBe(true);
    expect(envelope.data.id).toBe(id);
    expect(envelope.meta.syncPending).toBe(true);
    const task = await adapter.getTask(id);
    expect(task.projectId).toBe(projectId);
  });

  it("reports `from` and `to` locations", async () => {
    const { ctx, adapter } = makeCtx();
    const projectA = await adapter.createProject({ name: "a" });
    const projectB = await adapter.createProject({ name: "b" });
    const id = await adapter.createTask({ name: "t", projectId: projectA });

    const envelope = await handleTaskMove({ id, projectId: projectB }, ctx);

    expect(envelope.data).toMatchObject({
      moved: true,
      from: { projectId: projectA },
      to: { projectId: projectB },
    });
  });

  it("moves a task under a parent (subtask)", async () => {
    const { ctx, adapter } = makeCtx();
    const parentId = await adapter.createTask({ name: "parent" });
    const id = await adapter.createTask({ name: "child" });

    await handleTaskMove({ id, parentId }, ctx);

    const task = await adapter.getTask(id);
    expect(task.parentId).toBe(parentId);
  });

  it("moves a project task back to the inbox when toInbox: true", async () => {
    const { ctx, adapter } = makeCtx();
    const projectId = await adapter.createProject({ name: "p" });
    const id = await adapter.createTask({ name: "t", projectId });

    const envelope = await handleTaskMove({ id, toInbox: true }, ctx);

    expect(envelope.data).toMatchObject({ moved: true, to: { inbox: true } });
    const task = await adapter.getTask(id);
    expect(task.projectId).toBeNull();
    expect(task.parentId).toBeNull();
  });

  it("is idempotent when the task is already at the destination project", async () => {
    const { ctx, adapter } = makeCtx();
    const projectId = await adapter.createProject({ name: "p" });
    const id = await adapter.createTask({ name: "t", projectId });

    const envelope = await handleTaskMove({ id, projectId }, ctx);

    expect("noChange" in envelope.data && envelope.data.noChange).toBe(true);
    expect(envelope.meta.syncPending).toBeFalsy();
  });

  it("is idempotent when an inbox task is asked to move to the inbox", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "t" });
    const envelope = await handleTaskMove({ id, toInbox: true }, ctx);
    expect("noChange" in envelope.data && envelope.data.noChange).toBe(true);
  });

  it("propagates NotFound when the task does not exist", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTaskMove({ id: "task_missing" as never, toInbox: true }, ctx),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("propagates NotFound when the destination project does not exist", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "t" });
    await expect(
      handleTaskMove({ id, projectId: "proj_missing" as never }, ctx),
    ).rejects.toBeInstanceOf(NotFound);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("task_move — cache invalidation", () => {
  it("invalidates both the source and destination project scopes", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const projectA = await adapter.createProject({ name: "a" });
    const projectB = await adapter.createProject({ name: "b" });
    const id = await adapter.createTask({ name: "t", projectId: projectA });

    await handleTaskMove({ id, projectId: projectB }, { ...base, cache });

    expect(scopes).toContain(`task:${id}`);
    expect(scopes).toContain(`project:${projectA}`);
    expect(scopes).toContain(`project:${projectB}`);
    expect(scopes).toContain("forecast:*");
    expect(scopes).toContain("perspective:*");
    expect(scopes).toContain("search:*");
  });

  it("emits only source-project scope when moving to the inbox", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const projectId = await adapter.createProject({ name: "p" });
    const id = await adapter.createTask({ name: "t", projectId });

    await handleTaskMove({ id, toInbox: true }, { ...base, cache });

    expect(scopes).toContain(`project:${projectId}`);
    // No new project scope emitted — we didn't move to one.
    expect(scopes.filter((s) => s.startsWith("project:"))).toEqual([`project:${projectId}`]);
  });

  it("does not invalidate on noChange", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const projectId = await adapter.createProject({ name: "p" });
    const id = await adapter.createTask({ name: "t", projectId });

    await handleTaskMove({ id, projectId }, { ...base, cache });

    expect(scopes).toEqual([]);
  });
});
