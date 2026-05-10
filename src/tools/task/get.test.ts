/**
 * Tests for task_get tool.
 *
 * Covers: happy path, subtasks included/excluded, NotFound for unknown ID,
 * required id field schema validation.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { TaskId } from "../../domain/ids.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { TaskService } from "../../services/taskService.js";
import { handleTaskGet, taskGetInputSchema } from "./get.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx() {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const cache = {
    wrap: async <T>(_key: string, factory: () => Promise<T>) => factory(),
    has: (_key: string) => false,
  };
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

describe("task_get — input schema", () => {
  it("requires id field", () => {
    expect(() => taskGetInputSchema.parse({})).toThrow();
  });

  it("accepts a valid id", () => {
    const parsed = taskGetInputSchema.parse({ id: "task_000001" });
    expect(parsed.id).toBe("task_000001");
  });

  it("accepts includeSubtasks boolean", () => {
    const parsed = taskGetInputSchema.parse({ id: "task_000001", includeSubtasks: false });
    expect(parsed.includeSubtasks).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("task_get — happy path", () => {
  it("returns subtaskIds by default (includeSubtasks omitted)", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Parent task" });

    const envelope = await handleTaskGet({ id }, ctx);
    expect(envelope.data.task.name).toBe("Parent task");
    expect(envelope.data.task.id).toBe(id);
    expect(Array.isArray(envelope.data.subtaskIds)).toBe(true);
    expect(envelope.data.subtasks).toBeUndefined();
  });

  it("returns subtasks when child tasks exist", async () => {
    const { ctx, adapter } = makeCtx();
    const parentId = await adapter.createTask({ name: "Parent" });
    await adapter.createTask({ name: "Child 1", parentId });
    await adapter.createTask({ name: "Child 2", parentId });

    const envelope = await handleTaskGet({ id: parentId, includeSubtasks: true }, ctx);
    expect(envelope.data.subtasks).toHaveLength(2);
    const names = envelope.data.subtasks?.map((t) => t.name) ?? [];
    expect(names).toContain("Child 1");
    expect(names).toContain("Child 2");
  });

  it("returns subtaskIds when includeSubtasks omitted (default false)", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Solo task" });
    const childId = await adapter.createTask({ name: "Child", parentId: id });

    const envelope = await handleTaskGet({ id }, ctx);
    expect(envelope.data.task.name).toBe("Solo task");
    expect(envelope.data.subtasks).toBeUndefined();
    expect(envelope.data.subtaskIds).toEqual([childId]);
    expect(envelope.data.subtaskCount).toBe(1);
  });

  it("returns empty subtaskIds array when task has no children", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Leaf task" });

    const envelope = await handleTaskGet({ id }, ctx);
    expect(envelope.data.subtaskIds).toHaveLength(0);
    expect(envelope.data.subtaskCount).toBe(0);
    expect(envelope.data.subtasks).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// NotFound
// ---------------------------------------------------------------------------

describe("task_get — NotFound", () => {
  it("rejects with NotFound for unknown ID", async () => {
    const { ctx } = makeCtx();
    const ghost = "task_999999" as TaskId;

    await expect(handleTaskGet({ id: ghost }, ctx)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Note preview (#775)
// ---------------------------------------------------------------------------

describe("task_get — note preview truncation", () => {
  it("returns short notes inline (no truncation triplet) by default", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "n", note: "small note" });

    const envelope = await handleTaskGet({ id }, ctx);
    const task = envelope.data.task as unknown as Record<string, unknown>;
    expect(task.note).toBe("small note");
    expect(task).not.toHaveProperty("notePreview");
  });

  it("truncates long notes and emits the preview triplet by default", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "n", note: "x".repeat(500) });

    const envelope = await handleTaskGet({ id }, ctx);
    const task = envelope.data.task as unknown as Record<string, unknown>;
    expect(task.note).toBeUndefined();
    expect(task.notePreview).toBe("x".repeat(200));
    expect(task.noteTruncated).toBe(true);
    expect(task.noteLength).toBe(500);
  });

  it("truncates subtask notes too when includeSubtasks=true", async () => {
    const { ctx, adapter } = makeCtx();
    const parentId = await adapter.createTask({ name: "P" });
    await adapter.createTask({ name: "C", parentId, note: "y".repeat(400) });

    const envelope = await handleTaskGet({ id: parentId, includeSubtasks: true }, ctx);
    const subtask = envelope.data.subtasks?.[0] as unknown as Record<string, unknown> | undefined;
    expect(subtask?.notePreview).toBe("y".repeat(200));
    expect(subtask?.noteTruncated).toBe(true);
    expect(subtask?.noteLength).toBe(400);
  });

  it("returns full note inline when notePreviewChars is -1", async () => {
    const { ctx, adapter } = makeCtx();
    const longNote = "z".repeat(500);
    const id = await adapter.createTask({ name: "n", note: longNote });

    const envelope = await handleTaskGet({ id, notePreviewChars: -1 }, ctx);
    const task = envelope.data.task as unknown as Record<string, unknown>;
    expect(task.note).toBe(longNote);
    expect(task).not.toHaveProperty("notePreview");
  });
});
