/**
 * Tests for the `tag_get` tool — schema parsing + handler behaviour.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { TagService } from "../../services/tagService.js";
import { handleTagGet, TAG_GET_DESCRIPTION, tagGetInputSchema } from "./get.js";

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

describe("tag_get — input schema", () => {
  it("parses a valid tag ID", () => {
    const parsed = tagGetInputSchema.parse({ id: "tag_000001" });
    expect(parsed.id).toBe("tag_000001");
  });

  it("rejects a missing id", () => {
    expect(() => tagGetInputSchema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("tag_get — handler", () => {
  it("returns the tag for a known ID", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "Work" });
    const envelope = await handleTagGet({ id }, ctx);
    expect(envelope.data.tag.id).toBe(id);
    expect(envelope.data.tag.name).toBe("Work");
  });

  it("includes taskCount in the returned tag", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "Work" });
    const envelope = await handleTagGet({ id }, ctx);
    expect(envelope.data.tag).toHaveProperty("taskCount");
  });

  it("throws NotFound for an unknown ID", async () => {
    const { ctx } = makeCtx();
    await expect(handleTagGet({ id: "tag_999999" as never }, ctx)).rejects.toThrow();
  });

  it("returns envelope meta", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "Personal" });
    const envelope = await handleTagGet({ id }, ctx);
    expect(envelope.meta.correlationId).toBe("test-cid");
  });
});

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

describe("tag_get — description", () => {
  it("is non-empty", () => {
    expect(TAG_GET_DESCRIPTION.length).toBeGreaterThan(10);
  });
});
