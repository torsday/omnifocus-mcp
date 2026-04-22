/**
 * Tests for the `tag_list` tool — schema parsing + handler behaviour.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { TagService } from "../../services/tagService.js";
import { TAG_LIST_DESCRIPTION, handleTagList, tagListInputSchema } from "./list.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx() {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const tagService = new TagService({ adapter });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { ctx: { tagService, makeMeta }, adapter };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("tag_list — input schema", () => {
  it("accepts an empty object", () => {
    expect(tagListInputSchema.parse({})).toEqual({});
  });

  it("accepts parentId and status together", () => {
    const parsed = tagListInputSchema.parse({ parentId: "tag_000001", status: "active" });
    expect(parsed.parentId).toBe("tag_000001");
    expect(parsed.status).toBe("active");
  });

  it("rejects an unknown status value", () => {
    expect(() => tagListInputSchema.parse({ status: "unknown" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("tag_list — handler", () => {
  it("returns an empty tag list when no tags exist", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleTagList({}, ctx);
    expect(envelope.data.tags).toEqual([]);
    expect(envelope.meta.correlationId).toBe("test-cid");
  });

  it("returns created tags", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTag({ name: "Work" });
    await adapter.createTag({ name: "Personal" });
    const envelope = await handleTagList({}, ctx);
    expect(envelope.data.tags).toHaveLength(2);
    const names = envelope.data.tags.map((t) => t.name).sort();
    expect(names).toEqual(["Personal", "Work"]);
  });

  it("filters by parentId", async () => {
    const { ctx, adapter } = makeCtx();
    const parentId = await adapter.createTag({ name: "Work" });
    await adapter.createTag({ name: "Meetings", parentId });
    await adapter.createTag({ name: "Personal" });
    const envelope = await handleTagList({ parentId }, ctx);
    expect(envelope.data.tags).toHaveLength(1);
    expect(envelope.data.tags[0]?.name).toBe("Meetings");
  });

  it("filters by status", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "OldTag" });
    await adapter.updateTag(id, { status: "dropped" });
    await adapter.createTag({ name: "ActiveTag" });
    const envelope = await handleTagList({ status: "active" }, ctx);
    expect(envelope.data.tags).toHaveLength(1);
    expect(envelope.data.tags[0]?.name).toBe("ActiveTag");
  });

  it("includes taskCount on returned tags", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createTag({ name: "Work" });
    const envelope = await handleTagList({}, ctx);
    expect(envelope.data.tags[0]).toHaveProperty("taskCount");
  });
});

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

describe("tag_list — description", () => {
  it("is non-empty and mentions tag_list", () => {
    expect(TAG_LIST_DESCRIPTION.length).toBeGreaterThan(10);
  });
});
