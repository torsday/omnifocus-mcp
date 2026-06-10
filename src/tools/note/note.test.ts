/**
 * Tests for note_get, note_set, note_append, note_get_html, note_set_html tools.
 *
 * Covers: schema validation, read/write on tasks and projects,
 * null/empty note semantics, append separator logic, NotFound propagation,
 * syncPending flag, HTML round-trip fidelity, and cache invalidation.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { InvalidatingCache } from "../../cache/invalidation.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { IdempotencyStore } from "../../server/idempotencyStore.js";

import { handleNoteAppend, noteAppendInputSchema } from "./append.js";
import { handleNoteGet, noteGetInputSchema } from "./get.js";
import { handleNoteGetHtml, noteGetHtmlInputSchema } from "./get_html.js";
import { handleNoteSet, noteSetInputSchema } from "./set.js";
import { handleNoteSetHtml, noteSetHtmlInputSchema } from "./set_html.js";

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

/** Minimal InvalidatingCache recorder — tracks every invalidate() call. */
function makeSpyCache(): { cache: InvalidatingCache; calls: string[] } {
  const calls: string[] = [];
  const cache: InvalidatingCache = {
    invalidate: (scope) => {
      calls.push(scope);
    },
  };
  return { cache, calls };
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

  it("invalidates task cache scope on task write", async () => {
    const { ctx, adapter } = makeCtx();
    const { cache, calls } = makeSpyCache();
    const id = await adapter.createTask({ name: "T" });
    await handleNoteSet({ targetKind: "task", id, note: "x" }, { ...ctx, cache });
    expect(calls.some((s) => s.startsWith("task:"))).toBe(true);
  });

  it("invalidates the task's project scope on task write (project_get caches the task tree)", async () => {
    const { ctx, adapter } = makeCtx();
    const { cache, calls } = makeSpyCache();
    const projectId = await adapter.createProject({ name: "P" });
    const id = await adapter.createTask({ name: "T", projectId });
    await handleNoteSet({ targetKind: "task", id, note: "x" }, { ...ctx, cache });
    expect(calls).toContain(`project:${projectId}`);
  });

  it("invalidates project cache scope on project write", async () => {
    const { ctx, adapter } = makeCtx();
    const { cache, calls } = makeSpyCache();
    const id = await adapter.createProject({ name: "P" });
    await handleNoteSet({ targetKind: "project", id, note: "x" }, { ...ctx, cache });
    expect(calls.some((s) => s.startsWith("project:"))).toBe(true);
  });

  it("does not throw when cache is omitted", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await expect(handleNoteSet({ targetKind: "task", id, note: "x" }, ctx)).resolves.toBeDefined();
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

  it("invalidates task cache scope on task append", async () => {
    const { ctx, adapter } = makeCtx();
    const { cache, calls } = makeSpyCache();
    const id = await adapter.createTask({ name: "T" });
    await handleNoteAppend({ targetKind: "task", id, text: "x" }, { ...ctx, cache });
    expect(calls.some((s) => s.startsWith("task:"))).toBe(true);
  });

  it("invalidates the task's project scope on task append (project_get caches the task tree)", async () => {
    const { ctx, adapter } = makeCtx();
    const { cache, calls } = makeSpyCache();
    const projectId = await adapter.createProject({ name: "P" });
    const id = await adapter.createTask({ name: "T", projectId });
    await handleNoteAppend({ targetKind: "task", id, text: "x" }, { ...ctx, cache });
    expect(calls).toContain(`project:${projectId}`);
  });

  it("invalidates project cache scope on project append", async () => {
    const { ctx, adapter } = makeCtx();
    const { cache, calls } = makeSpyCache();
    const id = await adapter.createProject({ name: "P" });
    await handleNoteAppend({ targetKind: "project", id, text: "x" }, { ...ctx, cache });
    expect(calls.some((s) => s.startsWith("project:"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// note_get_html — schema
// ---------------------------------------------------------------------------

describe("note_get_html — input schema", () => {
  it("requires targetKind and id", () => {
    expect(() => noteGetHtmlInputSchema.parse({})).toThrow();
    expect(() => noteGetHtmlInputSchema.parse({ targetKind: "task" })).toThrow();
  });

  it("accepts task targetKind", () => {
    const parsed = noteGetHtmlInputSchema.parse({ targetKind: "task", id: "task_000001" });
    expect(parsed.targetKind).toBe("task");
  });

  it("accepts project targetKind", () => {
    const parsed = noteGetHtmlInputSchema.parse({ targetKind: "project", id: "project_000001" });
    expect(parsed.targetKind).toBe("project");
  });

  it("rejects unknown targetKind", () => {
    expect(() => noteGetHtmlInputSchema.parse({ targetKind: "folder", id: "x" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// note_get_html — handler
// ---------------------------------------------------------------------------

describe("note_get_html — handler", () => {
  it("returns null when task has no noteHtml", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    const envelope = await handleNoteGetHtml({ targetKind: "task", id }, ctx);
    expect(envelope.data.noteHtml).toBeNull();
  });

  it("returns the task noteHtml", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T", noteHtml: "<b>hello</b>" });
    const envelope = await handleNoteGetHtml({ targetKind: "task", id }, ctx);
    expect(envelope.data.noteHtml).toBe("<b>hello</b>");
  });

  it("returns null when project has no noteHtml", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    const envelope = await handleNoteGetHtml({ targetKind: "project", id }, ctx);
    expect(envelope.data.noteHtml).toBeNull();
  });

  it("returns the project noteHtml", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P", noteHtml: "<ul><li>item</li></ul>" });
    const envelope = await handleNoteGetHtml({ targetKind: "project", id }, ctx);
    expect(envelope.data.noteHtml).toBe("<ul><li>item</li></ul>");
  });

  it("does not set syncPending on read", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    const envelope = await handleNoteGetHtml({ targetKind: "task", id }, ctx);
    expect(envelope.meta.syncPending).toBeUndefined();
  });

  it("throws NotFound for unknown task ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleNoteGetHtml({ targetKind: "task", id: "task_999999" }, ctx),
    ).rejects.toThrow();
  });

  it("throws NotFound for unknown project ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleNoteGetHtml({ targetKind: "project", id: "project_999999" }, ctx),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// note_set_html — schema
// ---------------------------------------------------------------------------

describe("note_set_html — input schema", () => {
  it("requires targetKind, id, and noteHtml", () => {
    expect(() => noteSetHtmlInputSchema.parse({ targetKind: "task", id: "task_000001" })).toThrow();
  });

  it("accepts null noteHtml (clear)", () => {
    const parsed = noteSetHtmlInputSchema.parse({
      targetKind: "task",
      id: "task_000001",
      noteHtml: null,
    });
    expect(parsed.noteHtml).toBeNull();
  });

  it("accepts empty string noteHtml", () => {
    const parsed = noteSetHtmlInputSchema.parse({
      targetKind: "task",
      id: "task_000001",
      noteHtml: "",
    });
    expect(parsed.noteHtml).toBe("");
  });

  it("accepts HTML fragment", () => {
    const parsed = noteSetHtmlInputSchema.parse({
      targetKind: "task",
      id: "task_000001",
      noteHtml: "<b>bold</b>",
    });
    expect(parsed.noteHtml).toBe("<b>bold</b>");
  });
});

// ---------------------------------------------------------------------------
// note_set_html — handler
// ---------------------------------------------------------------------------

describe("note_set_html — handler", () => {
  it("sets noteHtml on a task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await handleNoteSetHtml({ targetKind: "task", id, noteHtml: "<b>bold</b>" }, ctx);
    expect((await adapter.getTask(id)).noteHtml).toBe("<b>bold</b>");
  });

  it("sets noteHtml on a project", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    await handleNoteSetHtml({ targetKind: "project", id, noteHtml: "<ul><li>item</li></ul>" }, ctx);
    expect((await adapter.getProject(id)).noteHtml).toBe("<ul><li>item</li></ul>");
  });

  it("clears noteHtml when passed null", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T", noteHtml: "<b>old</b>" });
    await handleNoteSetHtml({ targetKind: "task", id, noteHtml: null }, ctx);
    expect((await adapter.getTask(id)).noteHtml).toBeNull();
  });

  it("overwrites existing noteHtml", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T", noteHtml: "<b>old</b>" });
    await handleNoteSetHtml({ targetKind: "task", id, noteHtml: "<i>new</i>" }, ctx);
    expect((await adapter.getTask(id)).noteHtml).toBe("<i>new</i>");
  });

  it("sets meta.syncPending = true", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    const envelope = await handleNoteSetHtml({ targetKind: "task", id, noteHtml: "<b>x</b>" }, ctx);
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("returns { updated: true, id }", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    const envelope = await handleNoteSetHtml({ targetKind: "task", id, noteHtml: "<b>x</b>" }, ctx);
    expect(envelope.data.updated).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("throws NotFound for unknown task ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleNoteSetHtml({ targetKind: "task", id: "task_999999", noteHtml: "<b>x</b>" }, ctx),
    ).rejects.toThrow();
  });

  it("HTML round-trip: bold, link, list", async () => {
    const { ctx, adapter } = makeCtx();
    const html = '<b>bold</b> <a href="https://example.com">link</a> <ul><li>item</li></ul>';
    const id = await adapter.createTask({ name: "T" });
    await handleNoteSetHtml({ targetKind: "task", id, noteHtml: html }, ctx);
    const envelope = await handleNoteGetHtml({ targetKind: "task", id }, ctx);
    expect(envelope.data.noteHtml).toBe(html);
  });

  it("invalidates task cache scope on task write", async () => {
    const { ctx, adapter } = makeCtx();
    const { cache, calls } = makeSpyCache();
    const id = await adapter.createTask({ name: "T" });
    await handleNoteSetHtml({ targetKind: "task", id, noteHtml: "<b>x</b>" }, { ...ctx, cache });
    expect(calls.some((s) => s.startsWith("task:"))).toBe(true);
  });

  it("invalidates the task's project scope on task write (project_get caches the task tree)", async () => {
    const { ctx, adapter } = makeCtx();
    const { cache, calls } = makeSpyCache();
    const projectId = await adapter.createProject({ name: "P" });
    const id = await adapter.createTask({ name: "T", projectId });
    await handleNoteSetHtml({ targetKind: "task", id, noteHtml: "<b>x</b>" }, { ...ctx, cache });
    expect(calls).toContain(`project:${projectId}`);
  });

  it("invalidates project cache scope on project write", async () => {
    const { ctx, adapter } = makeCtx();
    const { cache, calls } = makeSpyCache();
    const id = await adapter.createProject({ name: "P" });
    await handleNoteSetHtml({ targetKind: "project", id, noteHtml: "<b>x</b>" }, { ...ctx, cache });
    expect(calls.some((s) => s.startsWith("project:"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// note_* — name pairing (#606)
// ---------------------------------------------------------------------------

describe("note_set pairs name with id (#606)", () => {
  it("returns task name and echoes note for task target", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Buy groceries" });
    const envelope = await handleNoteSet({ targetKind: "task", id, note: "milk, eggs" }, ctx);
    expect(envelope.data.updated).toBe(true);
    expect(envelope.data.id).toBe(id);
    expect(envelope.data.targetKind).toBe("task");
    expect(envelope.data.name).toBe("Buy groceries");
    expect(envelope.data.note).toBe("milk, eggs");
  });

  it("returns project name and null note when cleared", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Q1 plan" });
    const envelope = await handleNoteSet({ targetKind: "project", id, note: null }, ctx);
    expect(envelope.data.targetKind).toBe("project");
    expect(envelope.data.name).toBe("Q1 plan");
    expect(envelope.data.note).toBeNull();
  });

  it("populates name-bearing summary in meta", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Renew passport" });
    const envelope = await handleNoteSet({ targetKind: "task", id, note: "x" }, ctx);
    expect(envelope.meta.humanReadableSummary).toContain("Renew passport");
  });
});

describe("note_append pairs name with id (#606)", () => {
  it("returns task name and combined note", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Daily journal", note: "day 1" });
    const envelope = await handleNoteAppend({ targetKind: "task", id, text: "day 2" }, ctx);
    expect(envelope.data.id).toBe(id);
    expect(envelope.data.targetKind).toBe("task");
    expect(envelope.data.name).toBe("Daily journal");
    expect(envelope.data.note).toBe("day 1\nday 2");
  });

  it("returns project name when appending to project", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Trip planning" });
    const envelope = await handleNoteAppend({ targetKind: "project", id, text: "first" }, ctx);
    expect(envelope.data.targetKind).toBe("project");
    expect(envelope.data.name).toBe("Trip planning");
    expect(envelope.data.note).toBe("first");
  });
});

describe("note_set_html pairs name with id (#606)", () => {
  it("returns task name and echoes noteHtml", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Write blog post" });
    const envelope = await handleNoteSetHtml(
      { targetKind: "task", id, noteHtml: "<b>draft</b>" },
      ctx,
    );
    expect(envelope.data.targetKind).toBe("task");
    expect(envelope.data.name).toBe("Write blog post");
    expect(envelope.data.noteHtml).toBe("<b>draft</b>");
  });

  it("returns project name and null noteHtml when cleared", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Migration" });
    const envelope = await handleNoteSetHtml({ targetKind: "project", id, noteHtml: null }, ctx);
    expect(envelope.data.targetKind).toBe("project");
    expect(envelope.data.name).toBe("Migration");
    expect(envelope.data.noteHtml).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// note_append — idempotency_key (#981)
// ---------------------------------------------------------------------------

describe("note_append — idempotency_key", () => {
  function makeIdCtx() {
    const base = makeCtx();
    const idempotencyStore = new IdempotencyStore();
    return {
      ctx: { ...base.ctx, idempotencyStore },
      adapter: base.adapter,
    };
  }

  it("accepts an idempotency_key field on the input schema", () => {
    const parsed = noteAppendInputSchema.parse({
      targetKind: "task",
      id: "task_001",
      text: "hello",
      idempotency_key: "k-1",
    });
    expect(parsed.idempotency_key).toBe("k-1");
  });

  it("rejects an empty idempotency_key", () => {
    expect(() =>
      noteAppendInputSchema.parse({
        targetKind: "task",
        id: "task_001",
        text: "hello",
        idempotency_key: "",
      }),
    ).toThrow();
  });

  it("rejects an idempotency_key > 128 chars", () => {
    expect(() =>
      noteAppendInputSchema.parse({
        targetKind: "task",
        id: "task_001",
        text: "hello",
        idempotency_key: "x".repeat(129),
      }),
    ).toThrow();
  });

  it("replays the original envelope on retry with the same key (no double append)", async () => {
    const { ctx, adapter } = makeIdCtx();
    const id = await adapter.createTask({ name: "T", note: "existing" });

    const first = await handleNoteAppend(
      { targetKind: "task", id, text: "added", idempotency_key: "k-1" },
      ctx,
    );
    expect(first.data.note).toBe("existing\nadded");
    expect(first.meta.idempotentReplay).toBeUndefined();

    // Second call with the same key — even with different text — replays
    // the first envelope. The note is NOT appended again (which is the
    // whole point of idempotency for append-shaped tools).
    const second = await handleNoteAppend(
      { targetKind: "task", id, text: "different", idempotency_key: "k-1" },
      ctx,
    );
    expect(second.data.note).toBe("existing\nadded");
    expect(second.meta.idempotentReplay).toBe(true);

    // Adapter saw only one write — the note has the first text once.
    const task = await adapter.getTask(id);
    expect(task.note).toBe("existing\nadded");
  });

  it("different keys are independent (each one appends)", async () => {
    const { ctx, adapter } = makeIdCtx();
    const id = await adapter.createTask({ name: "T" });

    await handleNoteAppend(
      { targetKind: "task", id, text: "first", idempotency_key: "key-a" },
      ctx,
    );
    await handleNoteAppend(
      { targetKind: "task", id, text: "second", idempotency_key: "key-b" },
      ctx,
    );

    const task = await adapter.getTask(id);
    expect(task.note).toBe("first\nsecond");
  });

  it("no key ⇒ no caching: second call appends again (the dangerous default)", async () => {
    const { ctx, adapter } = makeIdCtx();
    const id = await adapter.createTask({ name: "T" });

    await handleNoteAppend({ targetKind: "task", id, text: "x" }, ctx);
    await handleNoteAppend({ targetKind: "task", id, text: "x" }, ctx);

    const task = await adapter.getTask(id);
    // Without a key, identical replays compound. This is exactly the
    // failure mode #981's idempotency support prevents.
    expect(task.note).toBe("x\nx");
  });
});
