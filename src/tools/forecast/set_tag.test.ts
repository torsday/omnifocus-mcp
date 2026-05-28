/**
 * Unit tests for forecast_set_tag — covers happy path, clear, NotFound,
 * and cache invalidation contract.
 */

import { describe, expect, it, vi } from "vitest";
import { TagId as TagIdCtor } from "../../domain/ids.js";
import { NotFound } from "../../errors/index.js";
import { ForecastService } from "../../services/forecastService.js";
import { handleForecastSetTag } from "./set_tag.js";

function makeCtx(opts: {
  setResolves?: { tagId: ReturnType<typeof TagIdCtor.of> | null };
  setRejects?: Error;
  tagName?: string;
}) {
  // Composite write (#849): the adapter returns id+name in one call. The
  // service delegates straight through, so the mock resolves the paired shape.
  const setForecastTagWithName = vi.fn();
  if (opts.setRejects) {
    setForecastTagWithName.mockRejectedValue(opts.setRejects);
  } else {
    const tagId = opts.setResolves?.tagId ?? null;
    const name = tagId === null ? null : (opts.tagName ?? "Today");
    setForecastTagWithName.mockResolvedValue({ tagId, name });
  }
  const adapter = {
    setForecastTagWithName,
  } as unknown as ConstructorParameters<typeof ForecastService>[0]["adapter"];
  const cache = { invalidate: vi.fn() };
  return {
    forecastService: new ForecastService({ adapter }),
    cache,
    makeMeta: () => ({}) as never,
    _setSpy: setForecastTagWithName,
  };
}

describe("handleForecastSetTag", () => {
  it("sets the forecast tag and invalidates the forecast cache, returning paired name (#599)", async () => {
    const tagId = TagIdCtor.of("tag-today");
    const ctx = makeCtx({ setResolves: { tagId }, tagName: "Today" });
    const env = await handleForecastSetTag({ tagId }, ctx);
    expect(env.data).toEqual({ tagId, name: "Today" });
    expect(ctx._setSpy).toHaveBeenCalledWith(tagId);
    expect(ctx.cache.invalidate).toHaveBeenCalledWith("forecast:*");
  });

  it("clears the forecast tag when tagId is null", async () => {
    const ctx = makeCtx({ setResolves: { tagId: null } });
    const env = await handleForecastSetTag({ tagId: null }, ctx);
    expect(env.data).toEqual({ tagId: null, name: null });
    expect(ctx._setSpy).toHaveBeenCalledWith(null);
    expect(ctx.cache.invalidate).toHaveBeenCalledWith("forecast:*");
  });

  it("propagates NotFound when the supplied tag does not exist", async () => {
    const tagId = TagIdCtor.of("tag-missing");
    const ctx = makeCtx({ setRejects: new NotFound("Tag not found: tag-missing") });
    await expect(handleForecastSetTag({ tagId }, ctx)).rejects.toBeInstanceOf(NotFound);
    // Cache must NOT be invalidated on failure — preserves existing forecast cache validity
    expect(ctx.cache.invalidate).not.toHaveBeenCalled();
  });
});
