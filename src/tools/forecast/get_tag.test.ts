/**
 * Unit tests for forecast_get_tag — round-trips the adapter through
 * ForecastService and asserts the response envelope.
 */

import { describe, expect, it, vi } from "vitest";
import { TagId as TagIdCtor } from "../../domain/ids.js";
import { ForecastService } from "../../services/forecastService.js";
import { handleForecastGetTag } from "./get_tag.js";

function makeCtx(
  tagId: ReturnType<typeof TagIdCtor.of> | null,
  opts: { tagName?: string | null } = {},
) {
  // Composite read (#849): the adapter returns id+name in one call. The
  // service delegates straight through, so the mock supplies the paired shape.
  // `tagName: null` (explicit) models the adapter reporting a stale/orphan id.
  const resolvedName = "tagName" in opts ? opts.tagName : "Today";
  const name = tagId === null ? null : (resolvedName ?? null);
  const adapter = {
    getForecastTagWithName: vi.fn().mockResolvedValue({ tagId, name }),
  } as unknown as ConstructorParameters<typeof ForecastService>[0]["adapter"];
  return {
    forecastService: new ForecastService({ adapter }),
    makeMeta: () => ({}) as never,
  };
}

describe("handleForecastGetTag", () => {
  it("returns the configured forecast tag with paired name (#599)", async () => {
    const tag = TagIdCtor.of("tag-today");
    const ctx = makeCtx(tag, { tagName: "Today" });
    const env = await handleForecastGetTag({}, ctx);
    expect(env.data).toEqual({ tagId: tag, name: "Today" });
  });

  it("returns { tagId: null, name: null } when no forecast tag is configured", async () => {
    const ctx = makeCtx(null);
    const env = await handleForecastGetTag({}, ctx);
    expect(env.data).toEqual({ tagId: null, name: null });
  });

  it("passes through name: null when the adapter reports an orphan tag", async () => {
    // Post-#849 the composite OmniJS read can't observe a true orphan
    // (`Database.forecastTag` only resolves to a live tag or null), but the
    // InMemory adapter can return a stale id with name null; the service must
    // pass that shape through untouched.
    const tag = TagIdCtor.of("tag-orphan");
    const ctx = makeCtx(tag, { tagName: null });
    const env = await handleForecastGetTag({}, ctx);
    expect(env.data).toEqual({ tagId: tag, name: null });
  });
});
