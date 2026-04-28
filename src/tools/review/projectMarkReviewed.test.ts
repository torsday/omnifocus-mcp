/**
 * Tests for the `project_mark_reviewed` tool — schema + handler envelope.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ReviewService } from "../../services/reviewService.js";
import {
  handleProjectMarkReviewed,
  PROJECT_MARK_REVIEWED_DESCRIPTION,
  projectMarkReviewedInputSchema,
} from "./projectMarkReviewed.js";

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

describe("project_mark_reviewed — input schema", () => {
  it("requires id", () => {
    expect(() => projectMarkReviewedInputSchema.parse({})).toThrow();
  });

  it("rejects empty id", () => {
    expect(() => projectMarkReviewedInputSchema.parse({ id: "" })).toThrow();
  });

  it("accepts valid id", () => {
    expect(projectMarkReviewedInputSchema.parse({ id: "proj_001" })).toEqual({ id: "proj_001" });
  });
});

describe("project_mark_reviewed — description", () => {
  it("mentions review", () => {
    expect(PROJECT_MARK_REVIEWED_DESCRIPTION).toMatch(/review/i);
  });

  it("mentions syncPending", () => {
    expect(PROJECT_MARK_REVIEWED_DESCRIPTION).toMatch(/syncPending/i);
  });
});

describe("project_mark_reviewed — handler", () => {
  it("returns ok envelope with id and syncPending true", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "p1", reviewIntervalDays: 7 });

    const envelope = await handleProjectMarkReviewed({ id }, ctx);
    expect(envelope.data.id).toBe(id);
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("throws NotFound for unknown id", async () => {
    const { ctx } = makeCtx();
    await expect(handleProjectMarkReviewed({ id: "proj_nonexistent" }, ctx)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Name pairing (#607)
// ---------------------------------------------------------------------------

describe("project_mark_reviewed pairs name with id (#607)", () => {
  it("returns the project name and review dates after the mutation", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Annual planning", reviewIntervalDays: 365 });

    const env = await handleProjectMarkReviewed({ id }, ctx);
    expect(env.data.id).toBe(id);
    expect(env.data.name).toBe("Annual planning");
    expect(env.data.lastReviewDate).toEqual(expect.any(String));
    expect("nextReviewDate" in env.data).toBe(true);
  });
});
