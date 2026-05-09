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

// ---------------------------------------------------------------------------
// Inbox filter
// ---------------------------------------------------------------------------

describe("handleTaskList — inbox filter", () => {
  it("returns only inbox tasks (no project) when inbox=true", async () => {
    const { ctx, adapter } = makeCtx();
    // createProject returns a ProjectId (not a Project object).
    const projId = await adapter.createProject({ name: "P" });
    await adapter.createTask({ name: "inbox-task" });
    await adapter.createTask({ name: "project-task", projectId: projId });

    const result = await handleTaskList({ inbox: true }, ctx);
    expect(result.data.tasks).toHaveLength(1);
    expect(result.data.tasks[0]?.name).toBe("inbox-task");
  });

  it("inbox=true acts as a valid filter (no unbounded-query error)", async () => {
    const { ctx } = makeCtx();
    await expect(handleTaskList({ inbox: true }, ctx)).resolves.toBeDefined();
  });

  it("rejects inbox=true combined with projectId", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTaskList({ inbox: true, projectId: "proj_000001" as never }, ctx),
    ).rejects.toMatchObject({ code: "OF_VALIDATION" });
  });
});

// ---------------------------------------------------------------------------
// Note preview (#775)
// ---------------------------------------------------------------------------

describe("handleTaskList — note preview truncation", () => {
  it("returns short notes inline (no truncation triplet) by default", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "short", note: "small note", flagged: true });

    const result = await handleTaskList({ flagged: true }, ctx);
    const task = result.data.tasks[0];
    expect(task).toBeDefined();
    expect((task as { note?: string }).note).toBe("small note");
    expect(task).not.toHaveProperty("notePreview");
    expect(task).not.toHaveProperty("noteTruncated");
    expect(task).not.toHaveProperty("noteLength");
  });

  it("truncates long notes and emits the preview triplet by default (200 chars)", async () => {
    const { ctx, adapter } = makeCtx();
    const longNote = "x".repeat(500);
    await adapter.createTask({ name: "long", note: longNote, flagged: true });

    const result = await handleTaskList({ flagged: true }, ctx);
    const task = result.data.tasks[0] as unknown as Record<string, unknown>;
    expect(task.note).toBeUndefined();
    expect(task.notePreview).toBe("x".repeat(200));
    expect(task.noteTruncated).toBe(true);
    expect(task.noteLength).toBe(500);
  });

  it("respects a custom notePreviewChars override", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "n", note: "y".repeat(300), flagged: true });

    const result = await handleTaskList({ flagged: true, notePreviewChars: 50 }, ctx);
    const task = result.data.tasks[0] as unknown as Record<string, unknown>;
    expect(task.notePreview).toBe("y".repeat(50));
    expect(task.noteLength).toBe(300);
  });

  it("returns the full note inline when notePreviewChars is -1", async () => {
    const { ctx, adapter } = makeCtx();
    const longNote = "z".repeat(500);
    await adapter.createTask({ name: "n", note: longNote, flagged: true });

    const result = await handleTaskList({ flagged: true, notePreviewChars: -1 }, ctx);
    const task = result.data.tasks[0] as unknown as Record<string, unknown>;
    expect(task.note).toBe(longNote);
    expect(task).not.toHaveProperty("notePreview");
    expect(task).not.toHaveProperty("noteTruncated");
  });
});

// ---------------------------------------------------------------------------
// Default-valued field elision (#774)
// ---------------------------------------------------------------------------

describe("handleTaskList — default-valued field elision (#774)", () => {
  it("omits default-valued fields by default (verbose absent → elide)", async () => {
    const { ctx, adapter } = makeCtx();
    // A vanilla, unflagged, uncompleted task with no tags / due / note
    await adapter.createTask({ name: "vanilla", flagged: true });
    // Re-query with flagged: true so the service accepts the request, but the
    // task itself is the one we inspect.
    const result = await handleTaskList({ flagged: true }, ctx);
    const task = result.data.tasks[0] as unknown as Record<string, unknown>;

    // Required identity fields stay
    expect(task.id).toEqual(expect.any(String));
    expect(task.name).toBe("vanilla");

    // Default-valued booleans omitted
    expect(task).not.toHaveProperty("completed");
    expect(task).not.toHaveProperty("dropped");
    expect(task).not.toHaveProperty("blocked");
    expect(task).not.toHaveProperty("sequential");
    expect(task).not.toHaveProperty("completedByChildren");

    // Empty array tagIds omitted
    expect(task).not.toHaveProperty("tagIds");
    // Null reference fields omitted
    expect(task).not.toHaveProperty("dueDate");
    expect(task).not.toHaveProperty("deferDate");
    expect(task).not.toHaveProperty("parentId");

    // Non-default value (flagged: true) IS preserved
    expect(task.flagged).toBe(true);
  });

  it("preserves non-default values", async () => {
    const { ctx, adapter } = makeCtx();
    const tagId = await adapter.createTag({ name: "x" });
    await adapter.createTask({
      name: "loaded",
      flagged: true,
      tagIds: [tagId],
      dueDate: "2026-12-01T00:00:00Z",
    });
    const result = await handleTaskList({ flagged: true }, ctx);
    const task = result.data.tasks[0] as unknown as Record<string, unknown>;
    expect(task.tagIds).toEqual([tagId]);
    expect(task.dueDate).toBe("2026-12-01T00:00:00Z");
    expect(task.flagged).toBe(true);
  });

  it("verbose: true returns the full unelided shape", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTask({ name: "vanilla", flagged: true });
    const result = await handleTaskList({ flagged: true, verbose: true }, ctx);
    const task = result.data.tasks[0] as unknown as Record<string, unknown>;
    // Every default-valued field present at its default
    expect(task.completed).toBe(false);
    expect(task.dropped).toBe(false);
    expect(task.blocked).toBe(false);
    expect(task.tagIds).toEqual([]);
    expect(task.dueDate).toBeNull();
    expect(task.deferDate).toBeNull();
    expect(task.parentId).toBeNull();
  });

  it("schema documents the verbose flag", () => {
    const desc = taskListInputSchema.shape.verbose.description ?? "";
    expect(desc.toLowerCase()).toContain("default");
    expect(desc.toLowerCase()).toContain("omit");
  });
});
