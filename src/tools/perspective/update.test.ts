/**
 * Unit tests for `perspective_update` (#618).
 *
 * Coverage:
 *  - Schema: rule disjointness propagates from slice A; iconColor: null is
 *    a valid distinct value from undefined.
 *  - Built-in id rejection: every BUILTIN_PERSPECTIVE_IDS entry is rejected
 *    with ValidationError before the adapter is called.
 *  - Patch semantics: omitted fields leave existing values unchanged;
 *    rules: [] clears the rule tree; iconColor: null clears the color.
 *  - Duplicate-name rejection from the adapter surfaces as ValidationError.
 *  - NotFound on unknown identifier.
 *  - Cache invalidation: only on success.
 *  - syncPending flag.
 */

import { describe, expect, it, vi } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { InvalidatingCache } from "../../cache/invalidation.js";
import { BUILTIN_PERSPECTIVE_IDS } from "../../domain/perspective.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handlePerspectiveUpdate, perspectiveUpdateInputSchema } from "./update.js";

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
// Schema
// ---------------------------------------------------------------------------

describe("perspectiveUpdateInputSchema", () => {
  it("requires perspectiveId", () => {
    expect(perspectiveUpdateInputSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a minimal id-only payload (no patch fields)", () => {
    expect(perspectiveUpdateInputSchema.safeParse({ perspectiveId: "abc" }).success).toBe(true);
  });

  it("rejects an aggregate child that violates atom disjointness", () => {
    const r = perspectiveUpdateInputSchema.safeParse({
      perspectiveId: "abc",
      rules: [{ actionStatus: "flagged", actionHasNoProject: true }],
    });
    expect(r.success).toBe(false);
  });

  it("accepts iconColor: null as a valid clear-to-default value", () => {
    expect(
      perspectiveUpdateInputSchema.safeParse({ perspectiveId: "abc", iconColor: null }).success,
    ).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(perspectiveUpdateInputSchema.safeParse({ perspectiveId: "abc", name: "" }).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Built-in id rejection
// ---------------------------------------------------------------------------

describe("handlePerspectiveUpdate — built-in id rejection", () => {
  for (const id of BUILTIN_PERSPECTIVE_IDS) {
    it(`rejects built-in id "${id}" without calling the adapter`, async () => {
      const { ctx, adapter } = makeCtx();
      const spy = vi.spyOn(adapter, "updateCustomPerspective");
      await expect(handlePerspectiveUpdate({ perspectiveId: id, name: "x" }, ctx)).rejects.toThrow(
        /Built-in perspectives cannot be updated/,
      );
      expect(spy).not.toHaveBeenCalled();
    });
  }
});

// ---------------------------------------------------------------------------
// Patch semantics — happy path
// ---------------------------------------------------------------------------

describe("handlePerspectiveUpdate — patch semantics", () => {
  it("renames a perspective and leaves other fields unchanged", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createCustomPerspective({
      name: "Original",
      aggregation: "all",
      rules: [{ actionStatus: "flagged" }],
      iconColor: { r: 1, g: 0, b: 0, a: 1 },
    });

    await handlePerspectiveUpdate({ perspectiveId: id, name: "Renamed" }, ctx);
    const after = await adapter.getCustomPerspective(id);
    expect(after.name).toBe("Renamed");
    expect(after.aggregation).toBe("all");
    expect(after.rules).toEqual([{ actionStatus: "flagged" }]);
    expect(after.iconColor).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("rules: [] clears the rule tree to empty", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createCustomPerspective({
      name: "x",
      rules: [{ actionStatus: "flagged" }],
    });
    await handlePerspectiveUpdate({ perspectiveId: id, rules: [] }, ctx);
    expect((await adapter.getCustomPerspective(id)).rules).toEqual([]);
  });

  it("iconColor: null clears the color back to default", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createCustomPerspective({
      name: "x",
      iconColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    });
    await handlePerspectiveUpdate({ perspectiveId: id, iconColor: null }, ctx);
    expect((await adapter.getCustomPerspective(id)).iconColor).toBeNull();
  });

  it("rewrites the rule tree when patched", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createCustomPerspective({
      name: "x",
      rules: [{ actionStatus: "flagged" }],
    });
    const newRules = [
      {
        aggregateType: "any" as const,
        aggregateRules: [{ actionHasDueDate: true }],
      },
    ];
    await handlePerspectiveUpdate({ perspectiveId: id, aggregation: "any", rules: newRules }, ctx);
    const after = await adapter.getCustomPerspective(id);
    expect(after.aggregation).toBe("any");
    expect(after.rules).toEqual(newRules);
  });

  it("returns { id } and sets meta.syncPending = true", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createCustomPerspective({ name: "x" });
    const env = await handlePerspectiveUpdate({ perspectiveId: id, name: "y" }, ctx);
    expect(env.data.id).toBe(id);
    expect(env.meta.syncPending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("handlePerspectiveUpdate — error paths", () => {
  it("propagates NotFound for unknown identifier", async () => {
    const { ctx } = makeCtx();
    await expect(
      handlePerspectiveUpdate({ perspectiveId: "missing", name: "x" }, ctx),
    ).rejects.toThrow(/Custom perspective not found/);
  });

  it("rejects a duplicate name with ValidationError", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createCustomPerspective({ name: "Taken" });
    const other = await adapter.createCustomPerspective({ name: "Other" });
    await expect(
      handlePerspectiveUpdate({ perspectiveId: other, name: "Taken" }, ctx),
    ).rejects.toThrow(/Duplicate perspective name/);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("handlePerspectiveUpdate — cache invalidation", () => {
  it("invalidates the perspective scope on success", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createCustomPerspective({ name: "x" });
    const { cache, calls } = makeSpyCache();
    await handlePerspectiveUpdate({ perspectiveId: id, name: "y" }, { ...ctx, cache });
    expect(calls).toContain("perspective:*");
  });

  it("does not invalidate on failure (NotFound)", async () => {
    const { ctx } = makeCtx();
    const { cache, calls } = makeSpyCache();
    await expect(
      handlePerspectiveUpdate({ perspectiveId: "missing", name: "x" }, { ...ctx, cache }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("does not invalidate on built-in id rejection", async () => {
    const { ctx } = makeCtx();
    const { cache, calls } = makeSpyCache();
    await expect(
      handlePerspectiveUpdate({ perspectiveId: "inbox", name: "x" }, { ...ctx, cache }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
