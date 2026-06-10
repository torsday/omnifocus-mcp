/**
 * Tests for tag_set_location and tag_get_location tools.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { TagService } from "../../services/tagService.js";
import { handleTagGetLocation, tagGetLocationInputSchema } from "./getLocation.js";
import {
  handleTagSetLocation,
  TAG_SET_LOCATION_DESCRIPTION,
  tagSetLocationInputSchema,
} from "./setLocation.js";

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

const SAMPLE_LOCATION = {
  latitude: 37.7749,
  longitude: -122.4194,
  radiusMeters: 200,
  trigger: "entering" as const,
};

// ---------------------------------------------------------------------------
// tag_set_location — schema
// ---------------------------------------------------------------------------

describe("tag_set_location — input schema", () => {
  it("requires id, latitude, longitude, radiusMeters, trigger", () => {
    expect(() => tagSetLocationInputSchema.parse({})).toThrow();
    expect(() => tagSetLocationInputSchema.parse({ id: "tag_000001" })).toThrow();
  });

  it("accepts full valid input", () => {
    const parsed = tagSetLocationInputSchema.parse({ id: "tag_000001", ...SAMPLE_LOCATION });
    expect(parsed.latitude).toBe(37.7749);
    expect(parsed.trigger).toBe("entering");
  });

  it("accepts optional name", () => {
    const parsed = tagSetLocationInputSchema.parse({
      id: "tag_000001",
      ...SAMPLE_LOCATION,
      name: "Home",
    });
    expect(parsed.name).toBe("Home");
  });

  it("rejects out-of-range latitude", () => {
    expect(() =>
      tagSetLocationInputSchema.parse({ id: "tag_000001", ...SAMPLE_LOCATION, latitude: 95 }),
    ).toThrow();
  });

  it("rejects out-of-range longitude", () => {
    expect(() =>
      tagSetLocationInputSchema.parse({ id: "tag_000001", ...SAMPLE_LOCATION, longitude: -200 }),
    ).toThrow();
  });

  it("rejects negative radius", () => {
    expect(() =>
      tagSetLocationInputSchema.parse({
        id: "tag_000001",
        ...SAMPLE_LOCATION,
        radiusMeters: -1,
      }),
    ).toThrow();
  });

  it("rejects unknown trigger", () => {
    expect(() =>
      tagSetLocationInputSchema.parse({ id: "tag_000001", ...SAMPLE_LOCATION, trigger: "never" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// tag_set_location — description examples must satisfy the schema
// ---------------------------------------------------------------------------

describe("tag_set_location description examples", () => {
  it("every documented trigger example value passes the input schema", () => {
    // Tool descriptions are the LLM's contract — an example the schema
    // rejects costs every agent a failed round-trip.
    const examples = [...TAG_SET_LOCATION_DESCRIPTION.matchAll(/trigger: "([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(examples.length).toBeGreaterThan(0);
    for (const trigger of examples) {
      const result = tagSetLocationInputSchema.safeParse({
        id: "tag_000001",
        ...SAMPLE_LOCATION,
        trigger,
      });
      expect(result.success, `example trigger ${JSON.stringify(trigger)}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// tag_set_location — handler
// ---------------------------------------------------------------------------

describe("tag_set_location — handler", () => {
  it("sets the location on the tag", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "Home" });
    await handleTagSetLocation({ id, ...SAMPLE_LOCATION }, ctx);
    const tag = await adapter.getTag(id);
    expect(tag.location?.latitude).toBe(37.7749);
    expect(tag.location?.longitude).toBe(-122.4194);
    expect(tag.location?.radiusMeters).toBe(200);
    expect(tag.location?.trigger).toBe("entering");
  });

  it("sets optional location name", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "Home" });
    await handleTagSetLocation({ id, ...SAMPLE_LOCATION, name: "My House" }, ctx);
    const tag = await adapter.getTag(id);
    expect(tag.location?.name).toBe("My House");
  });

  it("defaults name to null when omitted", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "Work" });
    await handleTagSetLocation({ id, ...SAMPLE_LOCATION }, ctx);
    const tag = await adapter.getTag(id);
    expect(tag.location?.name).toBeNull();
  });

  it("overwrites a previously set location", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "Work" });
    await handleTagSetLocation({ id, ...SAMPLE_LOCATION }, ctx);
    await handleTagSetLocation(
      { id, latitude: 51.5, longitude: -0.12, radiusMeters: 500, trigger: "leaving" },
      ctx,
    );
    const tag = await adapter.getTag(id);
    expect(tag.location?.latitude).toBe(51.5);
    expect(tag.location?.trigger).toBe("leaving");
  });

  it("throws NotFound for unknown id", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTagSetLocation({ id: "tag_999999" as never, ...SAMPLE_LOCATION }, ctx),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// tag_get_location — schema
// ---------------------------------------------------------------------------

describe("tag_get_location — input schema", () => {
  it("requires id", () => {
    expect(() => tagGetLocationInputSchema.parse({})).toThrow();
  });

  it("accepts a valid tag ID", () => {
    expect(tagGetLocationInputSchema.parse({ id: "tag_000001" })).toEqual({ id: "tag_000001" });
  });
});

// ---------------------------------------------------------------------------
// tag_get_location — handler
// ---------------------------------------------------------------------------

describe("tag_get_location — handler", () => {
  it("returns null when no location is set", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "Work" });
    const envelope = await handleTagGetLocation({ id }, ctx);
    expect(envelope.data.location).toBeNull();
  });

  it("returns the location after it has been set", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "Home" });
    await handleTagSetLocation({ id, ...SAMPLE_LOCATION }, ctx);
    const envelope = await handleTagGetLocation({ id }, ctx);
    expect(envelope.data.location?.latitude).toBe(37.7749);
    expect(envelope.data.location?.trigger).toBe("entering");
  });

  it("returns null after location is cleared via tag_update", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTag({ name: "Home" });
    await handleTagSetLocation({ id, ...SAMPLE_LOCATION }, ctx);
    await adapter.updateTag(id, { location: null });
    const envelope = await handleTagGetLocation({ id }, ctx);
    expect(envelope.data.location).toBeNull();
  });

  it("throws NotFound for unknown id", async () => {
    const { ctx } = makeCtx();
    await expect(handleTagGetLocation({ id: "tag_999999" as never }, ctx)).rejects.toThrow();
  });
});
