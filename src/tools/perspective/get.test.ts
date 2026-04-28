/**
 * Tests for the `perspective_get` tool — schema parsing + handler behaviour.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { PerspectiveDetail } from "../../domain/perspective.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";
import { PerspectiveService } from "../../services/perspectiveService.js";
import {
  handlePerspectiveGet,
  PERSPECTIVE_GET_DESCRIPTION,
  perspectiveGetInputSchema,
} from "./get.js";

const SAMPLE: PerspectiveDetail = {
  id: "fOpKrtZBLaZ",
  name: "Daily Triage",
  aggregation: "any",
  rules: [
    { actionStatus: "flagged" },
    {
      aggregateType: "all",
      aggregateRules: [
        { actionAvailability: "available" },
        { actionHasAnyOfTags: ["tag-a", "tag-b"] },
      ],
    },
    { disabledRule: { actionStatus: "due" } },
  ],
  iconColor: { r: 0.2, g: 0.5, b: 0.9, a: 1 },
};

function makeCtx() {
  const adapter = new InMemoryAdapter();
  adapter.seedCustomPerspectiveDetail(SAMPLE);
  const perspectiveService = new PerspectiveService({ adapter });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { ctx: { perspectiveService, makeMeta }, adapter };
}

describe("perspective_get — input schema", () => {
  it("accepts a non-empty perspectiveId", () => {
    expect(perspectiveGetInputSchema.parse({ perspectiveId: "fOpKrtZBLaZ" })).toEqual({
      perspectiveId: "fOpKrtZBLaZ",
    });
  });

  it("rejects an empty perspectiveId", () => {
    expect(() => perspectiveGetInputSchema.parse({ perspectiveId: "" })).toThrow();
  });

  it("rejects missing perspectiveId", () => {
    expect(() => perspectiveGetInputSchema.parse({})).toThrow();
  });
});

describe("perspective_get — description", () => {
  it("explains when not to use (built-in perspectives)", () => {
    expect(PERSPECTIVE_GET_DESCRIPTION).toMatch(/built-in/i);
    expect(PERSPECTIVE_GET_DESCRIPTION).toMatch(/Do not use/i);
  });

  it("includes a worked example", () => {
    expect(PERSPECTIVE_GET_DESCRIPTION).toMatch(/Example:/);
  });

  it("mentions the Pro requirement", () => {
    expect(PERSPECTIVE_GET_DESCRIPTION).toMatch(/Pro/);
  });
});

describe("perspective_get — handler", () => {
  it("returns the seeded perspective detail", async () => {
    const { ctx } = makeCtx();
    const envelope = await handlePerspectiveGet({ perspectiveId: SAMPLE.id }, ctx);
    expect(envelope.data.perspective).toEqual(SAMPLE);
  });

  it("wraps result in ok envelope with meta", async () => {
    const { ctx } = makeCtx();
    const envelope = await handlePerspectiveGet({ perspectiveId: SAMPLE.id }, ctx);
    expect(envelope.meta.correlationId).toBe("test-cid");
    expect(envelope.meta.cacheHit).toBe(false);
  });

  it("rejects built-in perspective ids with ValidationError", async () => {
    const { ctx } = makeCtx();
    await expect(handlePerspectiveGet({ perspectiveId: "inbox" }, ctx)).rejects.toThrow(
      ValidationError,
    );
  });

  it("propagates NotFound for unknown custom-perspective ids", async () => {
    const { ctx } = makeCtx();
    await expect(handlePerspectiveGet({ perspectiveId: "missing" }, ctx)).rejects.toThrow();
  });
});
