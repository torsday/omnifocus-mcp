/**
 * Tests for the `review_list_due` tool — schema + handler envelope.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ReviewService } from "../../services/reviewService.js";
import {
  handleReviewListDue,
  REVIEW_LIST_DUE_DESCRIPTION,
  reviewListDueInputSchema,
} from "./listDue.js";

function makeCtx() {
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
  });
  const reviewService = new ReviewService({ adapter });
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

describe("review_list_due — input schema", () => {
  it("accepts an empty object", () => {
    expect(reviewListDueInputSchema.parse({})).toEqual({});
  });
});

describe("review_list_due — description", () => {
  it("mentions review", () => {
    expect(REVIEW_LIST_DUE_DESCRIPTION).toMatch(/review/i);
  });

  it("is read-only (no side effects)", () => {
    expect(REVIEW_LIST_DUE_DESCRIPTION).toMatch(/no side effects/i);
  });
});

describe("review_list_due — handler", () => {
  it("returns an ok envelope with a projects array", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createProject({ name: "p1" });
    await adapter.createProject({ name: "p2" });

    const envelope = await handleReviewListDue({}, ctx);
    expect(Array.isArray(envelope.data.projects)).toBe(true);
    expect(envelope.data.projects.length).toBe(2);
  });

  it("returns projects with null nextReviewDate as due", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createProject({ name: "no-interval" });
    const envelope = await handleReviewListDue({}, ctx);
    expect(envelope.data.projects.some((p) => p.name === "no-interval")).toBe(true);
  });

  it("sets cacheHit false in meta", async () => {
    const { ctx } = makeCtx();
    const envelope = await handleReviewListDue({}, ctx);
    expect(envelope.meta.cacheHit).toBe(false);
  });
});
