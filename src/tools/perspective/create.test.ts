/**
 * Unit tests for `perspective_create` (#617).
 *
 * Coverage:
 *  - Happy path: minimal name-only create returns an id and registers in the
 *    InMemory adapter so the perspective is immediately retrievable.
 *  - Full payload (rules, aggregation, iconColor) round-trips through the
 *    adapter and is reflected in `getCustomPerspective`.
 *  - Schema validation: input rule disjointness is enforced at the tool
 *    boundary (delegated to PerspectiveRuleInputSchema from slice A).
 *  - Duplicate names are rejected by the adapter — surfaces as ValidationError.
 *  - Cache invalidation: `perspective:*` scope is hit on success, not on failure.
 *  - Sync flag is set on success.
 *
 * The adapter-level OmniJS rollback contract is exercised separately in the
 * integration test (gated on OMNIFOCUS_INTEGRATION=1) and the script's own
 * shape — a unit test here would only re-test the InMemory stub, not the
 * production rollback path. Filed as a follow-up to #617.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { InvalidatingCache } from "../../cache/invalidation.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleperspectiveCreate, perspectiveCreateInputSchema } from "./create.js";

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
// Schema validation
// ---------------------------------------------------------------------------

describe("perspectiveCreateInputSchema", () => {
  it("requires a non-empty name", () => {
    expect(perspectiveCreateInputSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("accepts a minimal name-only payload", () => {
    expect(perspectiveCreateInputSchema.safeParse({ name: "x" }).success).toBe(true);
  });

  it("rejects an aggregate child that violates atom disjointness", () => {
    const r = perspectiveCreateInputSchema.safeParse({
      name: "x",
      rules: [{ actionStatus: "flagged", actionHasNoProject: true }],
    });
    expect(r.success).toBe(false);
  });

  it("accepts a deeply-nested rule tree", () => {
    const r = perspectiveCreateInputSchema.safeParse({
      name: "x",
      aggregation: "all",
      rules: [
        {
          aggregateType: "any",
          aggregateRules: [
            { actionStatus: "flagged" },
            { disabledRule: { actionHasDueDate: true } },
          ],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a complete iconColor object and rejects out-of-range floats", () => {
    expect(
      perspectiveCreateInputSchema.safeParse({
        name: "x",
        iconColor: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
      }).success,
    ).toBe(true);
    expect(
      perspectiveCreateInputSchema.safeParse({
        name: "x",
        iconColor: { r: 2, g: 0, b: 0, a: 1 },
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Handler — happy path
// ---------------------------------------------------------------------------

describe("handleperspectiveCreate — happy path", () => {
  it("returns { id, name } for a minimal create and registers the perspective", async () => {
    const { ctx, adapter } = makeCtx();
    const env = await handleperspectiveCreate({ name: "Today" }, ctx);
    expect(typeof env.data.id).toBe("string");
    expect(env.data.id.length).toBeGreaterThan(0);
    expect(env.data.name).toBe("Today");

    const detail = await adapter.getCustomPerspective(env.data.id);
    expect(detail.name).toBe("Today");
    expect(detail.aggregation).toBe("all");
    expect(detail.rules).toEqual([]);
    expect(detail.iconColor).toBeNull();
  });

  it("round-trips a full payload (rules + aggregation + iconColor)", async () => {
    const { ctx, adapter } = makeCtx();
    const rules = [
      { actionStatus: "flagged" as const },
      {
        aggregateType: "any" as const,
        aggregateRules: [{ actionHasNoProject: true }],
      },
    ];
    const env = await handleperspectiveCreate(
      {
        name: "Plate",
        aggregation: "any",
        rules,
        iconColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
      },
      ctx,
    );

    const detail = await adapter.getCustomPerspective(env.data.id);
    expect(detail.aggregation).toBe("any");
    expect(detail.rules).toEqual(rules);
    expect(detail.iconColor).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
  });

  it("sets meta.syncPending = true and a name-bearing summary", async () => {
    const { ctx } = makeCtx();
    const env = await handleperspectiveCreate({ name: "Today" }, ctx);
    expect(env.meta.syncPending).toBe(true);
    expect(env.meta.humanReadableSummary).toContain("Today");
  });
});

// ---------------------------------------------------------------------------
// Handler — error paths
// ---------------------------------------------------------------------------

describe("handleperspectiveCreate — error paths", () => {
  it("throws ValidationError on duplicate name", async () => {
    const { ctx } = makeCtx();
    await handleperspectiveCreate({ name: "duplicate" }, ctx);
    await expect(handleperspectiveCreate({ name: "duplicate" }, ctx)).rejects.toThrow(
      /Duplicate perspective name/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("handleperspectiveCreate — cache invalidation", () => {
  it("invalidates the perspective scope on success", async () => {
    const { ctx } = makeCtx();
    const { cache, calls } = makeSpyCache();
    await handleperspectiveCreate({ name: "Today" }, { ...ctx, cache });
    expect(calls).toContain("perspective:*");
  });

  it("does not invalidate on failure (duplicate name)", async () => {
    const { ctx } = makeCtx();
    await handleperspectiveCreate({ name: "first" }, ctx);
    const { cache, calls } = makeSpyCache();
    await expect(handleperspectiveCreate({ name: "first" }, { ...ctx, cache })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
