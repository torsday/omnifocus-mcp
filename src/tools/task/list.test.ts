/**
 * Tests for the `task_list` tool — schema parsing + handler behaviour.
 *
 * The schema tests guard the public MCP surface (field names, types,
 * defaults) against accidental drift. The handler tests verify the envelope
 * shape and the meta/pagination wiring; the underlying filter logic lives
 * in `taskService.test.ts` and is not duplicated here.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { TaskService } from "../../services/taskService.js";
import { handleTaskList, TASK_LIST_DESCRIPTION, taskListInputSchema } from "./list.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx() {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const cache = new OmniFocusLruCache({ ttlMs: 30_000 });
  const taskService = new TaskService({ adapter, cache });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { ctx: { taskService, makeMeta }, adapter };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("task_list — input schema", () => {
  it("accepts an empty object (validation happens in the service)", () => {
    const parsed = taskListInputSchema.parse({});
    expect(parsed).toEqual({});
  });

  it("accepts the full filter surface specified in DESIGN §26", () => {
    const parsed = taskListInputSchema.parse({
      projectId: "proj_000001",
      tagIds: ["tag_000001"],
      flagged: true,
      available: true,
      completed: "exclude",
      dueBefore: "2026-05-01T00:00:00Z",
      dueAfter: "2026-04-01T00:00:00Z",
      deferredBefore: "2026-04-15T00:00:00Z",
      parentId: "task_000001",
      limit: 50,
      cursor: "opaque",
    });
    expect(parsed.projectId).toBe("proj_000001");
    expect(parsed.limit).toBe(50);
  });

  it("rejects limit > 1000", () => {
    expect(() => taskListInputSchema.parse({ limit: 2000 })).toThrow();
  });

  it("rejects limit < 1", () => {
    expect(() => taskListInputSchema.parse({ limit: 0 })).toThrow();
  });

  it("rejects an unknown completed value", () => {
    expect(() => taskListInputSchema.parse({ completed: "mostly" })).toThrow();
  });

  it("rejects a malformed id", () => {
    expect(() => taskListInputSchema.parse({ projectId: "??" })).toThrow();
  });

  it("accepts sortBy values", () => {
    for (const v of ["dueDate", "createdAt", "modifiedAt", "name"]) {
      const parsed = taskListInputSchema.parse({ limit: 10, sortBy: v });
      expect(parsed.sortBy).toBe(v);
    }
  });

  it("rejects an unknown sortBy value", () => {
    expect(() => taskListInputSchema.parse({ limit: 10, sortBy: "priority" })).toThrow();
  });

  it("accepts sortDirection asc and desc", () => {
    expect(taskListInputSchema.parse({ limit: 10, sortDirection: "asc" }).sortDirection).toBe(
      "asc",
    );
    expect(taskListInputSchema.parse({ limit: 10, sortDirection: "desc" }).sortDirection).toBe(
      "desc",
    );
  });

  it("rejects an unknown sortDirection value", () => {
    expect(() => taskListInputSchema.parse({ limit: 10, sortDirection: "random" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Description contract
// ---------------------------------------------------------------------------

describe("task_list — description", () => {
  it("includes the use / do-not-use guidance agents rely on to disambiguate", () => {
    expect(TASK_LIST_DESCRIPTION).toMatch(/task_get/);
    expect(TASK_LIST_DESCRIPTION).toMatch(/pagination/);
    expect(TASK_LIST_DESCRIPTION).toMatch(/side effects/i);
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("handleTaskList — envelope", () => {
  it("wraps the service result in an ok() envelope with pagination", async () => {
    const { ctx, adapter } = makeCtx();
    for (let i = 0; i < 3; i++) await adapter.createTask({ name: `t${i}`, flagged: true });

    const result = await handleTaskList({ flagged: true, limit: 2 }, ctx);
    expect(result.data.tasks).toHaveLength(2);
    expect(result.pagination).toMatchObject({ hasMore: true });
    expect(result.pagination?.cursor).toEqual(expect.any(String));
    expect(result.meta.cacheHit).toBe(false);
  });

  it("propagates cacheHit into the response meta on a repeat call", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "a", flagged: true });
    await handleTaskList({ flagged: true, limit: 10 }, ctx);
    const second = await handleTaskList({ flagged: true, limit: 10 }, ctx);
    expect(second.meta.cacheHit).toBe(true);
  });

  it("surfaces service validation errors (unbounded query) to the caller", async () => {
    const { ctx } = makeCtx();
    await expect(handleTaskList({}, ctx)).rejects.toMatchObject({
      code: "OF_VALIDATION",
    });
  });
});
