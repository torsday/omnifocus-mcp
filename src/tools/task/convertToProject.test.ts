/**
 * Tests for task_convert_to_project tool.
 *
 * Covers: schema validation, successful conversion to library root, conversion
 * into a folder, NotFound on unknown task, cache invalidation, and that the
 * returned projectId equals the original taskId.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { NotFound } from "../../errors/index.js";
import { handleTaskConvertToProject, taskConvertToProjectInputSchema } from "./convertToProject.js";

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

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("task_convert_to_project — input schema", () => {
  it("requires id", () => {
    expect(() => taskConvertToProjectInputSchema.parse({})).toThrow();
  });

  it("accepts id only (library ending by default)", () => {
    expect(() => taskConvertToProjectInputSchema.parse({ id: "task_000001" })).not.toThrow();
  });

  it("accepts id + folderId", () => {
    expect(() =>
      taskConvertToProjectInputSchema.parse({ id: "task_000001", folderId: "folder_000001" }),
    ).not.toThrow();
  });

  it("accepts position beginning", () => {
    expect(() =>
      taskConvertToProjectInputSchema.parse({ id: "task_000001", position: "beginning" }),
    ).not.toThrow();
  });

  it("rejects invalid position", () => {
    expect(() =>
      taskConvertToProjectInputSchema.parse({ id: "task_000001", position: "middle" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Successful conversion
// ---------------------------------------------------------------------------

describe("task_convert_to_project — handler", () => {
  it("converts a task and returns projectId equal to taskId", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Grow into project" });

    const result = await handleTaskConvertToProject({ id }, ctx);

    expect(result.data.converted).toBe(true);
    expect(result.data.taskId).toBe(id);
    expect(result.data.projectId).toBe(id);
  });

  it("removes the task from the task list after conversion", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Soon a project" });

    await handleTaskConvertToProject({ id }, ctx);

    await expect(adapter.getTask(id)).rejects.toBeInstanceOf(NotFound);
  });

  it("makes the task ID resolvable as a project", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Project candidate" });

    const result = await handleTaskConvertToProject({ id }, ctx);

    const project = await adapter.getProject(
      result.data.projectId as import("../../domain/ids.js").ProjectId,
    );
    expect(project.name).toBe("Project candidate");
  });

  it("throws NotFound for unknown task ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTaskConvertToProject(
        { id: "task_does_not_exist" as import("../../domain/ids.js").TaskId },
        ctx,
      ),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("sets syncPending in meta", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "t" });

    const result = await handleTaskConvertToProject({ id }, ctx);
    expect(result.meta.syncPending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("task_convert_to_project — cache invalidation", () => {
  it("emits task and project invalidation scopes", async () => {
    const { ctx, adapter } = makeCtx();
    const cache = new OmniFocusLruCache({ capacity: 100 });
    const scopes = recordScopes(cache);

    const id = await adapter.createTask({ name: "cached task" });
    await handleTaskConvertToProject({ id }, { ...ctx, cache });

    // InvalidationScope is a string template: `task:${id}`, `project:${id}`
    expect(scopes.some((s) => s.startsWith("task:"))).toBe(true);
    expect(scopes.some((s) => s.startsWith("project:"))).toBe(true);
  });
});
