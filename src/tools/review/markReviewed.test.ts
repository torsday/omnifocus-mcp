/**
 * Tests for the `review_mark_reviewed` tool — schema + handler envelope + cache invalidation.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { InvalidatingCache } from "../../cache/invalidation.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ReviewService } from "../../services/reviewService.js";
import {
  REVIEW_MARK_REVIEWED_DESCRIPTION,
  handleReviewMarkReviewed,
  reviewMarkReviewedInputSchema,
} from "./markReviewed.js";

function makeSpyCache(): { cache: InvalidatingCache; calls: string[] } {
  const calls: string[] = [];
  const cache: InvalidatingCache = {
    invalidate: (scope) => {
      calls.push(scope);
    },
  };
  return { cache, calls };
}

function makeCtx(cache?: InvalidatingCache) {
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
  });
  const reviewService = new ReviewService({ adapter, ...(cache !== undefined && { cache }) });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { ctx: { reviewService, makeMeta }, adapter };
}

describe("review_mark_reviewed — input schema", () => {
  it("requires id", () => {
    expect(() => reviewMarkReviewedInputSchema.parse({})).toThrow();
  });

  it("rejects empty id", () => {
    expect(() => reviewMarkReviewedInputSchema.parse({ id: "" })).toThrow();
  });

  it("accepts valid id", () => {
    expect(reviewMarkReviewedInputSchema.parse({ id: "proj_001" })).toEqual({ id: "proj_001" });
  });
});

describe("review_mark_reviewed — description", () => {
  it("mentions review", () => {
    expect(REVIEW_MARK_REVIEWED_DESCRIPTION).toMatch(/review/i);
  });

  it("mentions syncPending", () => {
    expect(REVIEW_MARK_REVIEWED_DESCRIPTION).toMatch(/syncPending/i);
  });
});

describe("review_mark_reviewed — handler", () => {
  it("returns ok envelope with id and syncPending true", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "p1", reviewIntervalDays: 7 });

    const envelope = await handleReviewMarkReviewed({ id }, ctx);
    expect(envelope.data.id).toBe(id);
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("throws NotFound for unknown id", async () => {
    const { ctx } = makeCtx();
    await expect(handleReviewMarkReviewed({ id: "proj_nonexistent" }, ctx)).rejects.toThrow();
  });

  it("invalidates project cache scope after marking reviewed", async () => {
    const { cache, calls } = makeSpyCache();
    const { ctx, adapter } = makeCtx(cache);
    const id = await adapter.createProject({ name: "p1", reviewIntervalDays: 7 });

    await handleReviewMarkReviewed({ id }, ctx);
    expect(calls.some((s) => s.startsWith("project:"))).toBe(true);
  });

  it("does not throw when ReviewService has no cache", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "p1", reviewIntervalDays: 7 });
    await expect(handleReviewMarkReviewed({ id }, ctx)).resolves.toBeDefined();
  });
});
