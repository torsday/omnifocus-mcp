/**
 * Unit tests for forecast_get_tag — round-trips the adapter through
 * ForecastService and asserts the response envelope.
 */

import { describe, expect, it, vi } from "vitest";
import { TagId as TagIdCtor } from "../../domain/ids.js";
import { ForecastService } from "../../services/forecastService.js";
import { handleForecastGetTag } from "./get_tag.js";

function makeCtx(tagId: ReturnType<typeof TagIdCtor.of> | null) {
  const adapter = {
    getForecastTag: vi.fn().mockResolvedValue({ tagId }),
  } as unknown as ConstructorParameters<typeof ForecastService>[0]["adapter"];
  return {
    forecastService: new ForecastService({ adapter }),
    makeMeta: () => ({}) as never,
  };
}

describe("handleForecastGetTag", () => {
  it("returns the configured forecast tag", async () => {
    const tag = TagIdCtor.of("tag-today");
    const ctx = makeCtx(tag);
    const env = await handleForecastGetTag({}, ctx);
    expect(env.data).toEqual({ tagId: tag });
  });

  it("returns { tagId: null } when no forecast tag is configured", async () => {
    const ctx = makeCtx(null);
    const env = await handleForecastGetTag({}, ctx);
    expect(env.data).toEqual({ tagId: null });
  });
});
