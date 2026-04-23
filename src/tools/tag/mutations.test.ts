/**
 * Tests for tag mutation tools: tag_create, tag_update, tag_delete,
 * tag_move, tag_set_status, tag_set_allows_next_action.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { TagService } from "../../services/tagService.js";
import { handleTagCreate, tagCreateInputSchema } from "./create.js";
import { handleTagDelete, tagDeleteInputSchema } from "./delete.js";
import { handleTagMove, tagMoveInputSchema } from "./move.js";
import {
  handleTagSetAllowsNextAction,
  tagSetAllowsNextActionInputSchema,
} from "./setAllowsNextAction.js";
import { handleTagSetStatus, tagSetStatusInputSchema } from "./setStatus.js";
import { handleTagUpdate, tagUpdateInputSchema } from "./update.js";

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
// tag_create
// ---------------------------------------------------------------------------

describe("tag_create — input schema", () => {
  it("requires name", () => {
    expect(() => tagCreateInputSchema.parse({})).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => tagCreateInputSchema.parse({ name: "" })).toThrow();
  });

  it("accepts minimal input", () => {
    expect(tagCreateInputSchema.parse({ name: "Work" })).toEqual({ name: "Work" });
  });

  it("accepts full input", () => {
    const parsed = tagCreateInputSchema.parse({
      name: "Work",
      parentId: "tag_000001",
      status: "on-hold",
      allowsNextAction: false,
    });
    expect(parsed.name).toBe("Work");
    expect(parsed.status).toBe("on-hold");
  });

  it("rejects status=dropped at create time", () => {
    expect(() => tagCreateInputSchema.parse({ name: "X", status: "dropped" })).toThrow();
  });
});

describe("tag_create — handler", () => {
  it("creates a tag and returns the full tag entity", async () => {
    const { ctx, adapter } = makeCtx();
    const envelope = await handleTagCreate({ name: "Work" }, ctx);
    expect(envelope.data.tag.id).toBeTruthy();
    expect(envelope.data.tag.name).toBe("Work");
    // Returned entity matches a subsequent getTag
    const fetched = await adapter.getTag(envelope.data.tag.id);
    expect(fetched.id).toBe(envelope.data.tag.id);
    const tags = await adapter.listTags();
    expect(tags).toHaveLength(1);
  });

  it("creates a nested tag when parentId is supplied", async () => {
    const { ctx, adapter } = makeCtx();
    const parentId = await adapter.createTag({ name: "Work" });
    const envelope = await handleTagCreate({ name: "Meetings", parentId }, ctx);
    const child = await adapter.getTag(envelope.data.tag.id);
    expect(child.parentId).toBe(parentId);
  });

  it("throws NotFound for unknown parentId", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTagCreate({ name: "X", parentId: "tag_999999" as never }, ctx),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// tag_update
// ---------------------------------------------------------------------------

describe("tag_update — input schema", () => {
  it("requires id", () => {
    expect(() => tagUpdateInputSchema.parse({})).toThrow();
  });

  it("accepts id-only (no-op patch)", () => {
    const parsed = tagUpdateInputSchema.parse({ id: "tag_000001" });
    expect(parsed.id).toBe("tag_000001");
  });

  it("accepts null parentId to promote to root", () => {
    const parsed = tagUpdateInputSchema.parse({ id: "tag_000001", parentId: null });
    expect(parsed.parentId).toBeNull();
  });
});

describe("tag_update — handler", () => {
  it("renames a tag", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "OldName" });
    await handleTagUpdate({ id, name: "NewName" }, ctx);
    const tag = await adapter.getTag(id);
    expect(tag.name).toBe("NewName");
  });

  it("updates status", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "Work" });
    await handleTagUpdate({ id, status: "on-hold" }, ctx);
    const tag = await adapter.getTag(id);
    expect(tag.status).toBe("on-hold");
  });

  it("throws NotFound for unknown id", async () => {
    const { ctx } = makeCtx();
    await expect(handleTagUpdate({ id: "tag_999999" as never, name: "X" }, ctx)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// tag_delete
// ---------------------------------------------------------------------------

describe("tag_delete — input schema", () => {
  it("requires id", () => {
    expect(() => tagDeleteInputSchema.parse({})).toThrow();
  });
});

describe("tag_delete — handler", () => {
  it("deletes a tag", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "Temp" });
    await handleTagDelete({ id }, ctx);
    const tags = await adapter.listTags();
    expect(tags).toHaveLength(0);
  });

  it("throws NotFound for unknown id", async () => {
    const { ctx } = makeCtx();
    await expect(handleTagDelete({ id: "tag_999999" as never }, ctx)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// tag_move
// ---------------------------------------------------------------------------

describe("tag_move — input schema", () => {
  it("requires id and parentId", () => {
    expect(() => tagMoveInputSchema.parse({ id: "tag_000001" })).toThrow();
  });

  it("accepts null parentId", () => {
    const parsed = tagMoveInputSchema.parse({ id: "tag_000001", parentId: null });
    expect(parsed.parentId).toBeNull();
  });
});

describe("tag_move — handler", () => {
  it("moves a tag under a new parent", async () => {
    const { ctx, adapter } = makeCtx();
    const parentId = await adapter.createTag({ name: "Work" });
    const childId = await adapter.createTag({ name: "Meetings" });
    await handleTagMove({ id: childId, parentId }, ctx);
    const child = await adapter.getTag(childId);
    expect(child.parentId).toBe(parentId);
  });

  it("promotes a tag to root when parentId=null", async () => {
    const { ctx, adapter } = makeCtx();
    const parentId = await adapter.createTag({ name: "Work" });
    const childId = await adapter.createTag({ name: "Meetings", parentId });
    await handleTagMove({ id: childId, parentId: null }, ctx);
    const child = await adapter.getTag(childId);
    expect(child.parentId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// tag_set_status
// ---------------------------------------------------------------------------

describe("tag_set_status — input schema", () => {
  it("requires id and status", () => {
    expect(() => tagSetStatusInputSchema.parse({ id: "tag_000001" })).toThrow();
  });

  it("rejects unknown status", () => {
    expect(() => tagSetStatusInputSchema.parse({ id: "tag_000001", status: "unknown" })).toThrow();
  });
});

describe("tag_set_status — handler", () => {
  it("sets status to dropped", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "OldProject" });
    await handleTagSetStatus({ id, status: "dropped" }, ctx);
    const tag = await adapter.getTag(id);
    expect(tag.status).toBe("dropped");
  });

  it("throws NotFound for unknown id", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTagSetStatus({ id: "tag_999999" as never, status: "active" }, ctx),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// tag_set_allows_next_action
// ---------------------------------------------------------------------------

describe("tag_set_allows_next_action — input schema", () => {
  it("requires id and allowsNextAction", () => {
    expect(() => tagSetAllowsNextActionInputSchema.parse({ id: "tag_000001" })).toThrow();
  });
});

describe("tag_set_allows_next_action — handler", () => {
  it("disables next-action on a tag", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "Work", allowsNextAction: true });
    await handleTagSetAllowsNextAction({ id, allowsNextAction: false }, ctx);
    const tag = await adapter.getTag(id);
    expect(tag.allowsNextAction).toBe(false);
  });

  it("enables next-action on a tag", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "Work", allowsNextAction: false });
    await handleTagSetAllowsNextAction({ id, allowsNextAction: true }, ctx);
    const tag = await adapter.getTag(id);
    expect(tag.allowsNextAction).toBe(true);
  });

  it("throws NotFound for unknown id", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTagSetAllowsNextAction({ id: "tag_999999" as never, allowsNextAction: true }, ctx),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation (docs/cache-invalidation.md)
// ---------------------------------------------------------------------------

describe("TagService — cache invalidation", () => {
  it("create emits tag:${id}, forecast:*, perspective:*, search:*", async () => {
    const adapter = new InMemoryAdapter({ now: () => new Date(0) });
    const cache = new OmniFocusLruCache();
    const scopes: InvalidationScope[] = [];
    cache.on("cache.invalidated", (e: { scope: InvalidationScope }) => scopes.push(e.scope));
    const tagService = new TagService({ adapter, cache });

    const { id } = await tagService.create({ name: "Work" });

    expect(scopes).toEqual([`tag:${id}`, "forecast:*", "perspective:*", "search:*"]);
  });

  it("update / delete / move / setStatus / setAllowsNextAction all flush the tag scope set", async () => {
    const adapter = new InMemoryAdapter({ now: () => new Date(0) });
    const cache = new OmniFocusLruCache();
    const scopes: InvalidationScope[] = [];
    cache.on("cache.invalidated", (e: { scope: InvalidationScope }) => scopes.push(e.scope));
    const tagService = new TagService({ adapter, cache });

    const { id } = await tagService.create({ name: "Work" });
    scopes.length = 0;

    await tagService.update(id, { name: "Work!" });
    await tagService.move(id, null);
    await tagService.setStatus(id, "on-hold");
    await tagService.setAllowsNextAction(id, false);
    await tagService.delete(id);

    // Five mutations × four scopes each = 20 emissions, all with the same shape.
    expect(scopes).toHaveLength(20);
    for (let i = 0; i < 5; i++) {
      expect(scopes.slice(i * 4, i * 4 + 4)).toEqual([
        `tag:${id}`,
        "forecast:*",
        "perspective:*",
        "search:*",
      ]);
    }
  });
});
