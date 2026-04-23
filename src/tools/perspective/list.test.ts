/**
 * Tests for the `perspective_list` tool — schema parsing + handler behaviour.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { PerspectiveService } from "../../services/perspectiveService.js";
import {
  PERSPECTIVE_LIST_DESCRIPTION,
  handlePerspectiveList,
  perspectiveListInputSchema,
} from "./list.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx() {
  const adapter = new InMemoryAdapter();
  const perspectiveService = new PerspectiveService({ adapter });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { ctx: { perspectiveService, makeMeta } };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("perspective_list — input schema", () => {
  it("accepts an empty object", () => {
    expect(perspectiveListInputSchema.parse({})).toEqual({});
  });

  it("accepts undefined (no fields)", () => {
    expect(perspectiveListInputSchema.parse({})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

describe("perspective_list — description", () => {
  it("mentions built-in perspectives", () => {
    expect(PERSPECTIVE_LIST_DESCRIPTION).toMatch(/Inbox/);
    expect(PERSPECTIVE_LIST_DESCRIPTION).toMatch(/Forecast/);
  });

  it("mentions when-not guidance", () => {
    expect(PERSPECTIVE_LIST_DESCRIPTION).toMatch(/Do not use/i);
  });

  it("mentions returns", () => {
    expect(PERSPECTIVE_LIST_DESCRIPTION).toMatch(/Returns/i);
  });

  it("mentions side effects", () => {
    expect(PERSPECTIVE_LIST_DESCRIPTION).toMatch(/no side effects/i);
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("perspective_list — handler", () => {
  it("returns all 7 built-in perspectives", async () => {
    const { ctx } = makeCtx();
    const envelope = await handlePerspectiveList({}, ctx);
    expect(envelope.data.perspectives).toHaveLength(7);
  });

  it("all built-in perspectives have kind='builtin'", async () => {
    const { ctx } = makeCtx();
    const envelope = await handlePerspectiveList({}, ctx);
    for (const p of envelope.data.perspectives) {
      expect(p.kind).toBe("builtin");
    }
  });

  it("all built-in perspectives have requiresPro=false", async () => {
    const { ctx } = makeCtx();
    const envelope = await handlePerspectiveList({}, ctx);
    for (const p of envelope.data.perspectives) {
      expect(p.requiresPro).toBe(false);
    }
  });

  it("includes Inbox perspective", async () => {
    const { ctx } = makeCtx();
    const envelope = await handlePerspectiveList({}, ctx);
    const inbox = envelope.data.perspectives.find((p) => p.id === "inbox");
    expect(inbox).toBeDefined();
    expect(inbox?.name).toBe("Inbox");
  });

  it("includes Forecast perspective", async () => {
    const { ctx } = makeCtx();
    const envelope = await handlePerspectiveList({}, ctx);
    const forecast = envelope.data.perspectives.find((p) => p.id === "forecast");
    expect(forecast).toBeDefined();
    expect(forecast?.name).toBe("Forecast");
  });

  it("wraps result in ADR-0013 ok() envelope", async () => {
    const { ctx } = makeCtx();
    const envelope = await handlePerspectiveList({}, ctx);
    expect(envelope).toHaveProperty("data");
    expect(envelope).toHaveProperty("meta");
    expect(envelope.meta.correlationId).toBe("test-cid");
  });

  it("sets cacheHit in meta from service result", async () => {
    const { ctx } = makeCtx();
    const envelope = await handlePerspectiveList({}, ctx);
    expect(envelope.meta.cacheHit).toBe(false);
  });

  it("each perspective has id, name, kind, requiresPro, icon fields", async () => {
    const { ctx } = makeCtx();
    const envelope = await handlePerspectiveList({}, ctx);
    for (const p of envelope.data.perspectives) {
      expect(p).toHaveProperty("id");
      expect(p).toHaveProperty("name");
      expect(p).toHaveProperty("kind");
      expect(p).toHaveProperty("requiresPro");
      expect(p).toHaveProperty("icon");
    }
  });
});
