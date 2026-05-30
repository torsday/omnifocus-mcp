/**
 * Tests for task_get_many tool.
 *
 * Covers: schema validation, empty input fast-path, all-present batch,
 * mix of present + missing IDs (warnings), order preservation, max-100 guard.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { TaskId } from "../../domain/ids.js";
import { writeWaitingOn } from "../../domain/waitingOn.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskGetMany, taskGetManyInputSchema } from "./getMany.js";

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
// Schema
// ---------------------------------------------------------------------------

describe("task_get_many — input schema", () => {
  it("accepts an empty ids array", () => {
    const parsed = taskGetManyInputSchema.parse({ ids: [] });
    expect(parsed.ids).toHaveLength(0);
  });

  it("accepts a populated ids array", () => {
    const parsed = taskGetManyInputSchema.parse({ ids: ["task_000001"] });
    expect(parsed.ids).toHaveLength(1);
  });

  it("rejects more than 100 ids", () => {
    const ids = Array.from({ length: 101 }, (_, i) => `task_${String(i + 1).padStart(6, "0")}`);
    expect(() => taskGetManyInputSchema.parse({ ids })).toThrow();
  });

  it("requires ids field", () => {
    expect(() => taskGetManyInputSchema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Empty input fast-path
// ---------------------------------------------------------------------------

describe("task_get_many — empty input", () => {
  it("returns empty tasks array without touching the adapter", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleTaskGetMany({ ids: [] }, ctx);
    expect(envelope.data.tasks).toHaveLength(0);
    expect(envelope.meta.warnings).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// All-present batch
// ---------------------------------------------------------------------------

describe("task_get_many — all present", () => {
  it("returns all requested tasks", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "Task Alpha" });
    const id2 = await adapter.createTask({ name: "Task Beta" });
    const id3 = await adapter.createTask({ name: "Task Gamma" });

    const envelope = await handleTaskGetMany({ ids: [id1, id2, id3] }, ctx);
    expect(envelope.data.tasks).toHaveLength(3);
    expect(envelope.meta.warnings).toBeUndefined();
  });

  it("returns tasks in input-ID order", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "First" });
    const id2 = await adapter.createTask({ name: "Second" });
    const id3 = await adapter.createTask({ name: "Third" });

    // Request in reverse order
    const envelope = await handleTaskGetMany({ ids: [id3, id1, id2] }, ctx);
    const names = envelope.data.tasks.map((t) => t.name);
    expect(names).toEqual(["Third", "First", "Second"]);
  });

  it("fetches a single task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Solo task" });
    const envelope = await handleTaskGetMany({ ids: [id] }, ctx);
    expect(envelope.data.tasks[0]?.name).toBe("Solo task");
  });
});

// ---------------------------------------------------------------------------
// Missing IDs
// ---------------------------------------------------------------------------

describe("task_get_many — missing IDs", () => {
  it("omits missing IDs and emits WARN_IDS_NOT_FOUND", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "Exists" });
    const ghost = "task_999999" as TaskId;

    const envelope = await handleTaskGetMany({ ids: [id1, ghost] }, ctx);
    expect(envelope.data.tasks).toHaveLength(1);
    expect(envelope.data.tasks[0]?.name).toBe("Exists");

    expect(envelope.meta.warnings).toHaveLength(1);
    expect(envelope.meta.warnings?.[0]?.code).toBe("WARN_IDS_NOT_FOUND");
    expect(envelope.meta.warnings?.[0]?.details).toMatchObject({ missing: [ghost] });
  });

  it("returns empty tasks array with warning when all IDs are missing", async () => {
    const { ctx } = makeCtx();
    const ghost1 = "task_999998" as TaskId;
    const ghost2 = "task_999999" as TaskId;

    const envelope = await handleTaskGetMany({ ids: [ghost1, ghost2] }, ctx);
    expect(envelope.data.tasks).toHaveLength(0);
    expect(envelope.meta.warnings?.[0]?.code).toBe("WARN_IDS_NOT_FOUND");
    expect(envelope.meta.warnings?.[0]?.details).toMatchObject({ missing: [ghost1, ghost2] });
  });

  it("preserves order of found tasks when some IDs are missing", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTask({ name: "First" });
    const id2 = await adapter.createTask({ name: "Third" });
    const ghost = "task_999999" as TaskId;

    // ids: [id1, ghost, id2] → tasks: [First, Third] (ghost omitted)
    const envelope = await handleTaskGetMany({ ids: [id1, ghost, id2] }, ctx);
    expect(envelope.data.tasks.map((t) => t.name)).toEqual(["First", "Third"]);
  });
});

// ---------------------------------------------------------------------------
// Over-limit guard (defensive, bypassing schema)
// ---------------------------------------------------------------------------

describe("task_get_many — over-limit guard", () => {
  it("throws ValidationError when ids exceed 100 (direct handler call)", async () => {
    const { ctx } = makeCtx();
    const ids = Array.from(
      { length: 101 },
      (_, i) => `task_${String(i + 1).padStart(6, "0")}` as TaskId,
    );
    await expect(handleTaskGetMany({ ids }, ctx)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Note preview (#775)
// ---------------------------------------------------------------------------

describe("task_get_many — note preview truncation", () => {
  it("truncates each task's long note by default and leaves short notes inline", async () => {
    const { ctx, adapter } = makeCtx();
    const longId = await adapter.createTask({ name: "long", note: "a".repeat(500) });
    const shortId = await adapter.createTask({ name: "short", note: "small" });

    const envelope = await handleTaskGetMany({ ids: [longId, shortId] }, ctx);
    const [long, short] = envelope.data.tasks as unknown as Record<string, unknown>[];

    expect(long?.note).toBeUndefined();
    expect(long?.notePreview).toBe("a".repeat(200));
    expect(long?.noteTruncated).toBe(true);
    expect(long?.noteLength).toBe(500);

    expect(short?.note).toBe("small");
    expect(short).not.toHaveProperty("notePreview");
  });

  it("returns full notes inline when notePreviewChars is -1", async () => {
    const { ctx, adapter } = makeCtx();
    const longNote = "z".repeat(500);
    const id = await adapter.createTask({ name: "n", note: longNote });

    const envelope = await handleTaskGetMany({ ids: [id], notePreviewChars: -1 }, ctx);
    const task = envelope.data.tasks[0] as unknown as Record<string, unknown>;
    expect(task.note).toBe(longNote);
    expect(task).not.toHaveProperty("notePreview");
  });
});

// ---------------------------------------------------------------------------
// maxOutputBytes cap (#1060)
// ---------------------------------------------------------------------------

describe("task_get_many — maxOutputBytes cap (#1060)", () => {
  it("omits cap meta when maxOutputBytes is unset", async () => {
    const { ctx, adapter } = makeCtx();
    const ids: TaskId[] = [];
    for (let i = 0; i < 3; i++) ids.push(await adapter.createTask({ name: `Task number ${i}` }));
    const r = await handleTaskGetMany({ ids }, ctx);
    expect(r.data.tasks).toHaveLength(3);
    expect(r.meta).not.toHaveProperty("truncatedAtCap");
  });

  it("truncates with dropped ids in input order and bytes within the cap", async () => {
    const { ctx, adapter } = makeCtx();
    const ids: TaskId[] = [];
    for (let i = 0; i < 5; i++)
      ids.push(await adapter.createTask({ name: `Task number ${i} with a longer name for bytes` }));
    const full = await handleTaskGetMany({ ids }, ctx);
    const cap = Math.floor(Buffer.byteLength(JSON.stringify(full.data.tasks), "utf8") / 3);

    const r = await handleTaskGetMany({ ids, maxOutputBytes: cap }, ctx);
    expect(r.data.tasks.length).toBeGreaterThan(0);
    expect(r.data.tasks.length).toBeLessThan(5);
    expect(r.meta.truncatedAtCap).toBe(true);
    expect(r.meta.bytesReturned).toBeLessThanOrEqual(cap);
    expect(r.meta.itemsReturned).toBe(r.data.tasks.length);
    const keptIds = r.data.tasks.map((t) => (t as { id: string }).id);
    const warn = r.meta.warnings?.find((w) => w.code === "WARN_RESULT_TRUNCATED");
    expect(warn?.details?.droppedIds).toEqual(ids.filter((id) => !keptIds.includes(id)));
  });

  it("drops waitingOn entries for tasks trimmed by the cap", async () => {
    const { ctx, adapter } = makeCtx();
    const ids: TaskId[] = [];
    for (let i = 0; i < 5; i++)
      ids.push(
        await adapter.createTask({
          name: `WO task ${i}`,
          note: writeWaitingOn(null, {
            whom: `person ${i}`,
            what: `deliverable ${i} with padding text to grow the note size enough to matter`,
            since: "2026-01-01T00:00:00Z",
          }),
        }),
      );
    const full = await handleTaskGetMany({ ids, notePreviewChars: -1 }, ctx);
    const cap = Math.floor(Buffer.byteLength(JSON.stringify(full.data.tasks), "utf8") / 3);

    const r = await handleTaskGetMany({ ids, notePreviewChars: -1, maxOutputBytes: cap }, ctx);
    expect(r.meta.truncatedAtCap).toBe(true);
    const keptIds = new Set(r.data.tasks.map((t) => (t as { id: string }).id));
    const waitingOn = (r.data as { waitingOn?: Record<string, unknown> }).waitingOn ?? {};
    for (const id of Object.keys(waitingOn)) expect(keptIds.has(id)).toBe(true);
    expect(keptIds.size).toBeLessThan(5);
  });
});
