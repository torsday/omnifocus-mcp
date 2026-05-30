/**
 * Tests for project_get_many tool.
 *
 * Covers: schema validation, all-found, partial-miss (null positions),
 * full-miss, empty input fast-path, order preservation.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ProjectId } from "../../domain/ids.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleProjectGetMany, projectGetManyInputSchema } from "./getMany.js";

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

describe("project_get_many — input schema", () => {
  it("accepts empty ids array", () => {
    const result = projectGetManyInputSchema.parse({ ids: [] });
    expect(result.ids).toHaveLength(0);
  });

  it("accepts an array of IDs", () => {
    const result = projectGetManyInputSchema.parse({ ids: ["abc", "def"] });
    expect(result.ids).toHaveLength(2);
  });

  it("rejects more than 100 IDs", () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    expect(() => projectGetManyInputSchema.parse({ ids })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("project_get_many — handler", () => {
  it("returns empty array immediately for empty input", async () => {
    const { ctx } = makeCtx();
    const result = await handleProjectGetMany({ ids: [] }, ctx);
    expect(result.data.projects).toHaveLength(0);
  });

  it("returns all projects when all IDs exist", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createProject({ name: "Alpha" });
    const id2 = await adapter.createProject({ name: "Beta" });

    const result = await handleProjectGetMany({ ids: [id1, id2] }, ctx);
    expect(result.data.projects).toHaveLength(2);
    const names = result.data.projects.map((p) => p.name);
    expect(names).toContain("Alpha");
    expect(names).toContain("Beta");
  });

  it("preserves input order", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createProject({ name: "First" });
    const id2 = await adapter.createProject({ name: "Second" });
    const id3 = await adapter.createProject({ name: "Third" });

    const result = await handleProjectGetMany({ ids: [id3, id1, id2] }, ctx);
    expect(result.data.projects.map((p) => p.name)).toEqual(["Third", "First", "Second"]);
  });

  it("omits missing IDs from results and surfaces them in meta.warnings", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createProject({ name: "Exists" });
    const missing = "nonexistent-project-id" as typeof id1;

    const result = await handleProjectGetMany({ ids: [id1, missing] }, ctx);
    expect(result.data.projects).toHaveLength(1);
    expect(result.data.projects[0]?.name).toBe("Exists");
    expect(result.meta.warnings).toBeDefined();
    expect(result.meta.warnings?.[0]?.details?.missing).toContain(missing);
  });

  it("returns empty array and warnings when all IDs are missing", async () => {
    const { ctx } = makeCtx();
    const result = await handleProjectGetMany({ ids: ["no-such-a", "no-such-b"] as never[] }, ctx);
    expect(result.data.projects).toHaveLength(0);
    expect(result.meta.warnings).toBeDefined();
  });

  it("no warnings in meta when all IDs are found", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Present" });
    const result = await handleProjectGetMany({ ids: [id] }, ctx);
    expect(result.meta.warnings).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// maxOutputBytes cap (#1060)
// ---------------------------------------------------------------------------

describe("project_get_many — maxOutputBytes cap (#1060)", () => {
  it("omits cap meta when maxOutputBytes is unset", async () => {
    const { ctx, adapter } = makeCtx();
    const ids: ProjectId[] = [];
    for (let i = 0; i < 3; i++) ids.push(await adapter.createProject({ name: `Project ${i}` }));
    const r = await handleProjectGetMany({ ids }, ctx);
    expect(r.data.projects).toHaveLength(3);
    expect(r.meta).not.toHaveProperty("truncatedAtCap");
  });

  it("truncates with dropped ids in input order and bytes within the cap", async () => {
    const { ctx, adapter } = makeCtx();
    const ids: ProjectId[] = [];
    for (let i = 0; i < 5; i++)
      ids.push(await adapter.createProject({ name: `Project ${i} with a longer name for bytes` }));
    const full = await handleProjectGetMany({ ids }, ctx);
    const cap = Math.floor(Buffer.byteLength(JSON.stringify(full.data.projects), "utf8") / 3);

    const r = await handleProjectGetMany({ ids, maxOutputBytes: cap }, ctx);
    expect(r.data.projects.length).toBeGreaterThan(0);
    expect(r.data.projects.length).toBeLessThan(5);
    expect(r.meta.truncatedAtCap).toBe(true);
    expect(r.meta.bytesReturned).toBeLessThanOrEqual(cap);
    const keptIds = r.data.projects.map((p) => (p as { id: string }).id);
    const warn = r.meta.warnings?.find((w) => w.code === "WARN_RESULT_TRUNCATED");
    expect(warn?.details?.droppedIds).toEqual(ids.filter((id) => !keptIds.includes(id)));
  });
});
