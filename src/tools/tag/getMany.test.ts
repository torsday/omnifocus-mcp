/**
 * Tests for tag_get_many tool.
 *
 * Covers: schema validation, all-found, partial-miss, full-miss,
 * empty input fast-path, order preservation.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { TagId } from "../../domain/ids.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTagGetMany, tagGetManyInputSchema } from "./getMany.js";

function makeCtx() {
  const adapter = new InMemoryAdapter();
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

describe("tag_get_many — input schema", () => {
  it("accepts empty ids array", () => {
    const result = tagGetManyInputSchema.parse({ ids: [] });
    expect(result.ids).toHaveLength(0);
  });

  it("accepts an array of IDs", () => {
    const result = tagGetManyInputSchema.parse({ ids: ["abc", "def"] });
    expect(result.ids).toHaveLength(2);
  });

  it("rejects more than 100 IDs", () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    expect(() => tagGetManyInputSchema.parse({ ids })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("tag_get_many — handler", () => {
  it("returns empty array immediately for empty input", async () => {
    const { ctx } = makeCtx();
    const result = await handleTagGetMany({ ids: [] }, ctx);
    expect(result.data.tags).toHaveLength(0);
  });

  it("returns all tags when all IDs exist", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTag({ name: "Work" });
    const id2 = await adapter.createTag({ name: "Personal" });

    const result = await handleTagGetMany({ ids: [id1, id2] }, ctx);
    expect(result.data.tags).toHaveLength(2);
    const names = result.data.tags.map((t) => t.name);
    expect(names).toContain("Work");
    expect(names).toContain("Personal");
  });

  it("preserves input order", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTag({ name: "First" });
    const id2 = await adapter.createTag({ name: "Second" });
    const id3 = await adapter.createTag({ name: "Third" });

    const result = await handleTagGetMany({ ids: [id3, id1, id2] }, ctx);
    expect(result.data.tags.map((t) => t.name)).toEqual(["Third", "First", "Second"]);
  });

  it("omits missing IDs from results and surfaces them in meta.warnings", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createTag({ name: "Exists" });
    const missing = "nonexistent-tag-id" as typeof id1;

    const result = await handleTagGetMany({ ids: [id1, missing] }, ctx);
    expect(result.data.tags).toHaveLength(1);
    expect(result.data.tags[0]?.name).toBe("Exists");
    expect(result.meta.warnings).toBeDefined();
    expect(result.meta.warnings?.[0]?.details?.missing).toContain(missing);
  });

  it("returns empty array and warnings when all IDs are missing", async () => {
    const { ctx } = makeCtx();
    const result = await handleTagGetMany({ ids: ["no-such-a", "no-such-b"] as never[] }, ctx);
    expect(result.data.tags).toHaveLength(0);
    expect(result.meta.warnings).toBeDefined();
  });

  it("no warnings in meta when all IDs are found", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "Present" });
    const result = await handleTagGetMany({ ids: [id] }, ctx);
    expect(result.meta.warnings).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// maxOutputBytes cap (#1060)
// ---------------------------------------------------------------------------

describe("tag_get_many — maxOutputBytes cap (#1060)", () => {
  it("omits cap meta when maxOutputBytes is unset", async () => {
    const { ctx, adapter } = makeCtx();
    const ids: TagId[] = [];
    for (let i = 0; i < 3; i++) ids.push(await adapter.createTag({ name: `Tag ${i}` }));
    const r = await handleTagGetMany({ ids }, ctx);
    expect(r.data.tags).toHaveLength(3);
    expect(r.meta).not.toHaveProperty("truncatedAtCap");
  });

  it("truncates with dropped ids in input order and bytes within the cap", async () => {
    const { ctx, adapter } = makeCtx();
    const ids: TagId[] = [];
    for (let i = 0; i < 5; i++)
      ids.push(await adapter.createTag({ name: `Tag ${i} with a longer name for bytes` }));
    const full = await handleTagGetMany({ ids }, ctx);
    const cap = Math.floor(Buffer.byteLength(JSON.stringify(full.data.tags), "utf8") / 3);

    const r = await handleTagGetMany({ ids, maxOutputBytes: cap }, ctx);
    expect(r.data.tags.length).toBeGreaterThan(0);
    expect(r.data.tags.length).toBeLessThan(5);
    expect(r.meta.truncatedAtCap).toBe(true);
    expect(r.meta.bytesReturned).toBeLessThanOrEqual(cap);
    const keptIds = r.data.tags.map((t) => (t as { id: string }).id);
    const warn = r.meta.warnings?.find((w) => w.code === "WARN_RESULT_TRUNCATED");
    expect(warn?.details?.droppedIds).toEqual(ids.filter((id) => !keptIds.includes(id)));
  });
});
