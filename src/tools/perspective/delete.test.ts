/**
 * Tests for the `perspective_delete` tool — schema, handler, cache invalidation.
 */

import { describe, expect, it, vi } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { InvalidatingCache } from "../../cache/invalidation.js";
import type { PerspectiveDetail } from "../../domain/perspective.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";
import { PerspectiveService } from "../../services/perspectiveService.js";
import {
  handlePerspectiveDelete,
  PERSPECTIVE_DELETE_DESCRIPTION,
  perspectiveDeleteInputSchema,
} from "./delete.js";

const SAMPLE: PerspectiveDetail = {
  id: "fOpKrtZBLaZ",
  name: "Daily Triage",
  aggregation: "all",
  rules: [],
  iconColor: null,
};

function makeCtx() {
  const adapter = new InMemoryAdapter();
  adapter.seedCustomPerspectiveDetail(SAMPLE);
  const perspectiveService = new PerspectiveService({ adapter });
  const cache: InvalidatingCache = { invalidate: vi.fn() };
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { ctx: { perspectiveService, cache, makeMeta }, adapter, cache };
}

describe("perspective_delete — input schema", () => {
  it("accepts a non-empty perspectiveId", () => {
    expect(perspectiveDeleteInputSchema.parse({ perspectiveId: SAMPLE.id })).toEqual({
      perspectiveId: SAMPLE.id,
    });
  });

  it("rejects an empty perspectiveId", () => {
    expect(() => perspectiveDeleteInputSchema.parse({ perspectiveId: "" })).toThrow();
  });
});

describe("perspective_delete — description", () => {
  it("flags that deletion is permanent", () => {
    expect(PERSPECTIVE_DELETE_DESCRIPTION).toMatch(/permanent/i);
  });

  it("warns against deleting built-in perspectives", () => {
    expect(PERSPECTIVE_DELETE_DESCRIPTION).toMatch(/built-in/i);
  });

  it("recommends sync_trigger after deletion", () => {
    expect(PERSPECTIVE_DELETE_DESCRIPTION).toMatch(/sync_trigger/i);
  });

  it("includes a worked example", () => {
    expect(PERSPECTIVE_DELETE_DESCRIPTION).toMatch(/Example:/);
  });
});

describe("perspective_delete — handler", () => {
  it("deletes the perspective and echoes the id", async () => {
    const { ctx, adapter } = makeCtx();
    const envelope = await handlePerspectiveDelete({ perspectiveId: SAMPLE.id }, ctx);
    expect(envelope.data).toEqual({ id: SAMPLE.id });
    await expect(adapter.getCustomPerspective(SAMPLE.id)).rejects.toThrow();
  });

  it("invalidates the perspective cache scope", async () => {
    const { ctx, cache } = makeCtx();
    await handlePerspectiveDelete({ perspectiveId: SAMPLE.id }, ctx);
    expect(cache.invalidate).toHaveBeenCalledWith("perspective:*");
  });

  it("rejects built-in perspective ids with ValidationError", async () => {
    const { ctx, cache } = makeCtx();
    await expect(handlePerspectiveDelete({ perspectiveId: "flagged" }, ctx)).rejects.toThrow(
      ValidationError,
    );
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it("does not invalidate the cache when the adapter throws", async () => {
    const { ctx, cache } = makeCtx();
    await expect(handlePerspectiveDelete({ perspectiveId: "missing" }, ctx)).rejects.toThrow();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });
});
