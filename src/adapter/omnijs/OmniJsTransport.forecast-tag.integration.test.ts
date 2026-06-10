/**
 * Integration tests for the forecast-tag composite methods (#849).
 *
 * `getForecastTagWithName` / `setForecastTagWithName` route to OmniJS (the
 * `settings` store key `_ForecastBlessedTagIdentifier`); creating the
 * fixture tag routes to JXA. Both transports are exercised through a real
 * {@link TransportRouter}, so this is the live round-trip the AC calls for.
 *
 * Gated behind `OMNIFOCUS_INTEGRATION=1`; requires a running OmniFocus.
 * Run with:
 *   OMNIFOCUS_INTEGRATION=1 pnpm test:integration
 *
 * **State safety:** the suite snapshots the user's current forecast tag in
 * `beforeAll` and restores it in `afterAll`, and deletes the fixture tag it
 * creates — the database is left exactly as it was found.
 *
 * @see src/adapter/inMemory/InMemoryAdapter.test.ts — hermetic contract tests
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TagId } from "../../domain/ids.js";
import { JxaTransport } from "../jxa/JxaTransport.js";
import { TransportRouter } from "../router.js";
import { OmniJsTransport } from "./OmniJsTransport.js";

const INTEGRATION = process.env.OMNIFOCUS_INTEGRATION === "1";

describe.skipIf(!INTEGRATION)("forecast-tag composite — integration", () => {
  const router = TransportRouter.fromTransports(new JxaTransport(), new OmniJsTransport());
  let fixtureTagId: TagId;
  let original: { tagId: TagId | null; name: string | null };

  beforeAll(async () => {
    original = await router.getForecastTagWithName();
    fixtureTagId = await router.createTag({ name: "mcp-fixture-forecast-tag" });
  });

  afterAll(async () => {
    // Restore the user's original forecast tag, then drop the fixture tag.
    await router.setForecastTagWithName(original.tagId).catch(() => {
      /* best-effort restore */
    });
    if (fixtureTagId) {
      await router.deleteTag(fixtureTagId).catch(() => {
        /* already deleted */
      });
    }
  });

  it("setForecastTagWithName folds the tag name into the set response (one round-trip)", async () => {
    // This is the core #849 contract: the OmniJS set script returns the live
    // tag's name alongside its id, eliminating the separate JXA getTag spawn.
    const result = await router.setForecastTagWithName(fixtureTagId);
    expect(result.tagId).toBe(fixtureTagId);
    expect(result.name).toBe("mcp-fixture-forecast-tag");
  });

  it("getForecastTagWithName reads back the persisted forecast tag (real round-trip)", async () => {
    // set + get are separate evaluateJavascript invocations, so this pins
    // that the write actually persists in the settings store under
    // `_ForecastBlessedTagIdentifier` — the regression that shipped when the
    // scripts wrote a per-invocation `Database.forecastTag` expando instead.
    await router.setForecastTagWithName(fixtureTagId);
    const result = await router.getForecastTagWithName();
    expect(result.tagId).toBe(fixtureTagId);
    expect(result.name).toBe("mcp-fixture-forecast-tag");
  });

  it("setForecastTagWithName(null) clears and reads back null in one round-trip each", async () => {
    const result = await router.setForecastTagWithName(null);
    expect(result).toEqual({ tagId: null, name: null });
    expect(await router.getForecastTagWithName()).toEqual({ tagId: null, name: null });
  });
});
