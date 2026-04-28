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
  const adapter = {
    getForecastTag: vi.fn().mockResolvedValue({ tagId }),
    getTag: vi.fn().mockImplementation(async (id: ReturnType<typeof TagIdCtor.of>) => {
      if (opts.tagName === null) throw new Error("missing");
      return { id, name: opts.tagName ?? "Today" };
    }),
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

  it("returns name: null when the configured tag was deleted (orphan)", async () => {
    const tag = TagIdCtor.of("tag-orphan");
    const ctx = makeCtx(tag, { tagName: null }); // getTag will throw
    const env = await handleForecastGetTag({}, ctx);
    expect(env.data).toEqual({ tagId: tag, name: null });
  });
});
