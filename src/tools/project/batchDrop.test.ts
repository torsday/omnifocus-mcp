/**
 * Tests for project_batch_drop tool.
 *
 * Covers: schema validation, full success, partial failure (missing ID),
 * empty input rejection, dropped state verified, syncPending flag.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleProjectBatchDrop, projectBatchDropInputSchema } from "./batchDrop.js";

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

describe("project_batch_drop — input schema", () => {
  it("rejects empty items array", () => {
    expect(() => projectBatchDropInputSchema.parse({ items: [] })).toThrow();
  });

  it("accepts a valid single item", () => {
    const result = projectBatchDropInputSchema.parse({ items: [{ id: "abc" }] });
    expect(result.items).toHaveLength(1);
  });

  it("accepts multiple items", () => {
    const result = projectBatchDropInputSchema.parse({
      items: [{ id: "abc" }, { id: "def" }],
    });
    expect(result.items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("project_batch_drop — handler", () => {
  it("drops all projects and returns dropped[] on full success", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createProject({ name: "Project A" });
    const id2 = await adapter.createProject({ name: "Project B" });

    const result = await handleProjectBatchDrop({ items: [{ id: id1 }, { id: id2 }] }, ctx);

    expect(result.data.dropped).toHaveLength(2);
    expect(result.data.failed).toHaveLength(0);
    const p1 = await adapter.getProject(id1);
    const p2 = await adapter.getProject(id2);
    expect(p1.status).toBe("dropped");
    expect(p2.status).toBe("dropped");
  });

  it("reports partial failure when one ID does not exist", async () => {
    const { ctx, adapter } = makeCtx();
    const id1 = await adapter.createProject({ name: "Real Project" });
    const missing = "nonexistent-id" as typeof id1;

    const result = await handleProjectBatchDrop({ items: [{ id: id1 }, { id: missing }] }, ctx);

    expect(result.data.dropped).toHaveLength(1);
    expect(result.data.dropped[0]?.index).toBe(0);
    expect(result.data.failed).toHaveLength(1);
    expect(result.data.failed[0]?.index).toBe(1);
  });

  it("sets syncPending=true when at least one project dropped", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });

    const result = await handleProjectBatchDrop({ items: [{ id }] }, ctx);

    expect(result.meta.syncPending).toBe(true);
  });

  it("sets syncPending=false when all items fail", async () => {
    const { ctx } = makeCtx();

    const result = await handleProjectBatchDrop({ items: [{ id: "no-such-id" as never }] }, ctx);

    expect(result.data.dropped).toHaveLength(0);
    expect(result.data.failed).toHaveLength(1);
    expect(result.meta.syncPending).toBe(false);
  });

  it("preserves per-index positions in mixed success/failure", async () => {
    const { ctx, adapter } = makeCtx();
    const id0 = await adapter.createProject({ name: "P0" });
    const id2 = await adapter.createProject({ name: "P2" });

    const result = await handleProjectBatchDrop(
      { items: [{ id: id0 }, { id: "missing" as typeof id0 }, { id: id2 }] },
      ctx,
    );

    expect(result.data.dropped.map((d) => d.index)).toEqual([0, 2]);
    expect(result.data.failed.map((f) => f.index)).toEqual([1]);
  });
});
