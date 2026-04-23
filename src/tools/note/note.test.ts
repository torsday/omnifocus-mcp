/**
 * Tests for note_get, note_set, note_append tools.
 *
 * Covers: schema validation, read/write on tasks and projects,
 * null/empty note semantics, append separator logic, NotFound propagation,
 * and syncPending flag.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleNoteAppend, noteAppendInputSchema } from "./append.js";
import { handleNoteGet, noteGetInputSchema } from "./get.js";
import { handleNoteSet, noteSetInputSchema } from "./set.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

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
// note_get — schema
// ---------------------------------------------------------------------------

describe("note_get — input schema", () => {
  it("requires targetKind and id", () => {
    expect(() => noteGetInputSchema.parse({})).toThrow();
    expect(() => noteGetInputSchema.parse({ targetKind: "task" })).toThrow();
  });

  it("accepts task targetKind", () => {
    const parsed = noteGetInputSchema.parse({ targetKind: "task", id: "task_000001" });
    expect(parsed.targetKind).toBe("task");
  });

  it("accepts project targetKind", () => {
    const parsed = noteGetInputSchema.parse({ targetKind: "project", id: "project_000001" });
    expect(parsed.targetKind).toBe("project");
  });

  it("rejects unknown targetKind", () => {
    expect(() => noteGetInputSchema.parse({ targetKind: "folder", id: "x" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// note_get — handler
// ---------------------------------------------------------------------------

describe("note_get — handler", () => {
  it("returns null when task has no note", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    const envelope = await handleNoteGet({ targetKind: "task", id }, ctx);
    expect(envelope.data.note).toBeNull();
  });

  it("returns the task note", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T", note: "hello" });
    const envelope = await handleNoteGet({ targetKind: "task", id }, ctx);
    expect(envelope.data.note).toBe("hello");
  });

  it("returns null when project has no note", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    const envelope = await handleNoteGet({ targetKind: "project", id }, ctx);
    expect(envelope.data.note).toBeNull();
  });

  it("returns the project note", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P", note: "proj note" });
    const envelope = await handleNoteGet({ targetKind: "project", id }, ctx);
    expect(envelope.data.note).toBe("proj note");
  });

  it("does not set syncPending on read", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    const envelope = await handleNoteGet({ targetKind: "task", id }, ctx);
    expect(envelope.meta.syncPending).toBeUndefined();
  });

  it("throws NotFound for unknown task ID", async () => {
    const { ctx } = makeCtx();
    await expect(handleNoteGet({ targetKind: "task", id: "task_999999" }, ctx)).rejects.toThrow();
  });

  it("throws NotFound for unknown project ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleNoteGet({ targetKind: "project", id: "project_999999" }, ctx),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// note_set — schema
// ---------------------------------------------------------------------------

describe("note_set — input schema", () => {
  it("requires targetKind, id, and note", () => {
    expect(() => noteSetInputSchema.parse({ targetKind: "task", id: "task_000001" })).toThrow();
  });

  it("accepts null note (clear)", () => {
    const parsed = noteSetInputSchema.parse({ targetKind: "task", id: "task_000001", note: null });
    expect(parsed.note).toBeNull();
  });

  it("accepts empty string note", () => {
    const parsed = noteSetInputSchema.parse({ targetKind: "task", id: "task_000001", note: "" });
    expect(parsed.note).toBe("");
  });
});

// ---------------------------------------------------------------------------
// note_set — handler
// ---------------------------------------------------------------------------

describe("note_set — handler", () => {
  it("sets a note on a task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await handleNoteSet({ targetKind: "task", id, note: "new note" }, ctx);
    expect((await adapter.getTask(id)).note).toBe("new note");
  });

  it("sets a note on a project", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    await handleNoteSet({ targetKind: "project", id, note: "proj note" }, ctx);
    expect((await adapter.getProject(id)).note).toBe("proj note");
  });

  it("clears a task note when passed null", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T", note: "old" });
    await handleNoteSet({ targetKind: "task", id, note: null }, ctx);
    expect((await adapter.getTask(id)).note).toBeNull();
  });

  it("overwrites an existing note", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T", note: "old" });
    await handleNoteSet({ targetKind: "task", id, note: "new" }, ctx);
    expect((await adapter.getTask(id)).note).toBe("new");
  });

  it("sets meta.syncPending = true", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    const envelope = await handleNoteSet({ targetKind: "task", id, note: "x" }, ctx);
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("returns { updated: true, id }", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    const envelope = await handleNoteSet({ targetKind: "task", id, note: "x" }, ctx);
    expect(envelope.data.updated).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("throws NotFound for unknown task ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleNoteSet({ targetKind: "task", id: "task_999999", note: "x" }, ctx),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// note_append — schema
// ---------------------------------------------------------------------------

describe("note_append — input schema", () => {
  it("requires targetKind, id, and text", () => {
    expect(() => noteAppendInputSchema.parse({ targetKind: "task", id: "task_000001" })).toThrow();
  });

  it("rejects empty text", () => {
    expect(() =>
      noteAppendInputSchema.parse({ targetKind: "task", id: "task_000001", text: "" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// note_append — handler
// ---------------------------------------------------------------------------

describe("note_append — handler", () => {
  it("appends to a task with no existing note", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await handleNoteAppend({ targetKind: "task", id, text: "first line" }, ctx);
    expect((await adapter.getTask(id)).note).toBe("first line");
  });

  it("appends with a newline separator when note exists", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T", note: "existing" });
    await handleNoteAppend({ targetKind: "task", id, text: "appended" }, ctx);
    expect((await adapter.getTask(id)).note).toBe("existing\nappended");
  });

  it("appends to a project note", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P", note: "proj" });
    await handleNoteAppend({ targetKind: "project", id, text: "more" }, ctx);
    expect((await adapter.getProject(id)).note).toBe("proj\nmore");
  });

  it("multiple appends accumulate correctly", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await handleNoteAppend({ targetKind: "task", id, text: "a" }, ctx);
    await handleNoteAppend({ targetKind: "task", id, text: "b" }, ctx);
    await handleNoteAppend({ targetKind: "task", id, text: "c" }, ctx);
    expect((await adapter.getTask(id)).note).toBe("a\nb\nc");
  });

  it("sets meta.syncPending = true", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    const envelope = await handleNoteAppend({ targetKind: "task", id, text: "x" }, ctx);
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("throws NotFound for unknown task ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleNoteAppend({ targetKind: "task", id: "task_999999", text: "x" }, ctx),
    ).rejects.toThrow();
  });
});
