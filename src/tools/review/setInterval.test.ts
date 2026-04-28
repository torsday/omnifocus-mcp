/**
 * Tests for the `review_set_interval` tool — schema + handler envelope + cache invalidation.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { InvalidatingCache } from "../../cache/invalidation.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ReviewService } from "../../services/reviewService.js";
import {
  handleReviewSetInterval,
  REVIEW_SET_INTERVAL_DESCRIPTION,
  reviewSetIntervalInputSchema,
} from "./setInterval.js";

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

describe("review_set_interval — input schema", () => {
  it("requires id and days", () => {
    expect(() => reviewSetIntervalInputSchema.parse({})).toThrow();
  });

  it("requires id when only days given", () => {
    expect(() => reviewSetIntervalInputSchema.parse({ days: 7 })).toThrow();
  });

  it("accepts valid id and days", () => {
    expect(reviewSetIntervalInputSchema.parse({ id: "proj_001", days: 14 })).toEqual({
      id: "proj_001",
      days: 14,
    });
  });

  it("accepts null days to remove interval", () => {
    expect(reviewSetIntervalInputSchema.parse({ id: "proj_001", days: null })).toEqual({
      id: "proj_001",
      days: null,
    });
  });

  it("rejects non-integer days", () => {
    expect(() => reviewSetIntervalInputSchema.parse({ id: "proj_001", days: 1.5 })).toThrow();
  });

  it("rejects days < 1", () => {
    expect(() => reviewSetIntervalInputSchema.parse({ id: "proj_001", days: 0 })).toThrow();
  });
});

describe("review_set_interval — description", () => {
  it("mentions review", () => {
    expect(REVIEW_SET_INTERVAL_DESCRIPTION).toMatch(/review/i);
  });

  it("mentions syncPending", () => {
    expect(REVIEW_SET_INTERVAL_DESCRIPTION).toMatch(/syncPending/i);
  });
});

describe("review_set_interval — handler", () => {
  it("returns ok envelope with id and syncPending true", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "p1" });

    const envelope = await handleReviewSetInterval({ id, days: 14 }, ctx);
    expect(envelope.data.id).toBe(id);
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("updates reviewIntervalDays on the project", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "p1" });

    await handleReviewSetInterval({ id, days: 21 }, ctx);
    const project = await adapter.getProject(id);
    expect(project.reviewIntervalDays).toBe(21);
  });

  it("removes review interval when days is null", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "p1", reviewIntervalDays: 7 });

    await handleReviewSetInterval({ id, days: null }, ctx);
    const project = await adapter.getProject(id);
    expect(project.reviewIntervalDays).toBeNull();
  });

  it("invalidates project cache scope after setting interval", async () => {
    const { cache, calls } = makeSpyCache();
    const { ctx, adapter } = makeCtx(cache);
    const id = await adapter.createProject({ name: "p1" });

    await handleReviewSetInterval({ id, days: 14 }, ctx);
    expect(calls.some((s) => s.startsWith("project:"))).toBe(true);
  });

  it("does not throw when ReviewService has no cache", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "p1" });
    await expect(handleReviewSetInterval({ id, days: 7 }, ctx)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Name pairing (#607)
// ---------------------------------------------------------------------------

describe("review_set_interval pairs name with id (#607)", () => {
  it("returns the project name and the new interval", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Reading list", reviewIntervalDays: 30 });

    const env = await handleReviewSetInterval({ id, days: 90 }, ctx);
    expect(env.data.id).toBe(id);
    expect(env.data.name).toBe("Reading list");
    expect(env.data.reviewIntervalDays).toBe(90);
  });

  it("returns null reviewIntervalDays when cleared", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Backlog", reviewIntervalDays: 7 });

    const env = await handleReviewSetInterval({ id, days: null }, ctx);
    expect(env.data.name).toBe("Backlog");
    expect(env.data.reviewIntervalDays).toBeNull();
  });
});
