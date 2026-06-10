import { describe, expect, it } from "vitest";
import forecastTagSetWithNameScript from "./forecast_tag_set_with_name.js";
import forecastTagWithNameScript from "./forecast_tag_with_name.js";

/**
 * Hermetic unit tests for the forecast-tag OmniJS scripts.
 *
 * The forecast-tag preference lives in the OmniJS `settings` store under
 * `_ForecastBlessedTagIdentifier` — `Database.forecastTag` does not exist
 * (verified live; assigning it is a per-invocation expando that never
 * persists). These tests evaluate the raw script sources against a mocked
 * OmniJS global surface so the settings round-trip is pinned without a
 * running OmniFocus.
 */

const FORECAST_KEY = "_ForecastBlessedTagIdentifier";

interface FakeTag {
  id: { primaryKey: string };
  name: string;
}

/** Mutable mock of the OmniJS `settings` store (string values only). */
function fakeSettings(initial: Record<string, string>) {
  const store = new Map(Object.entries(initial));
  return {
    objectForKey: (key: string) => store.get(key) ?? "",
    setObjectForKey: (value: string | null, key: string) => {
      if (value === null) store.delete(key);
      else store.set(key, value);
    },
    /** Test-only readback of the raw stored value (undefined = cleared). */
    _raw: (key: string) => store.get(key),
  };
}

/**
 * Evaluate an OmniJS script source with the given globals in scope.
 * `globalThis` is shadowed by a parameter so `globalThis.__args` resolves
 * to the supplied args without touching the real Node global.
 */
function runScript<T>(source: string, globals: Record<string, unknown>, args: unknown = {}): T {
  const names = Object.keys(globals);
  const values = names.map((n) => globals[n]);
  // biome-ignore lint/security/noGlobalEval: intentional — direct eval is the mechanism that runs the OmniJS script body against mocked globals without a live OmniFocus.
  const fn = new Function("globalThis", ...names, "__source", "return eval(__source);") as (
    ...fnArgs: unknown[]
  ) => string;
  return JSON.parse(fn({ __args: args }, ...values, source)) as T;
}

describe("forecast_tag_with_name.js (read)", () => {
  const tag: FakeTag = { id: { primaryKey: "tag-1" }, name: "Today" };
  const Tag = {
    byIdentifier: (id: string) => (id === tag.id.primaryKey ? tag : null),
  };

  it("resolves the stored identifier to {tagId, name}", () => {
    const settings = fakeSettings({ [FORECAST_KEY]: "tag-1" });
    const result = runScript(forecastTagWithNameScript, { settings, Tag });
    expect(result).toEqual({ tagId: "tag-1", name: "Today" });
  });

  it("returns {null, null} when the key holds the cleared default ''", () => {
    const settings = fakeSettings({});
    const result = runScript(forecastTagWithNameScript, { settings, Tag });
    expect(result).toEqual({ tagId: null, name: null });
  });

  it("returns {null, null} for an orphaned identifier (tag deleted)", () => {
    const settings = fakeSettings({ [FORECAST_KEY]: "gone-tag" });
    const result = runScript(forecastTagWithNameScript, { settings, Tag });
    expect(result).toEqual({ tagId: null, name: null });
  });
});

describe("forecast_tag_set_with_name.js (set)", () => {
  const tag: FakeTag = { id: { primaryKey: "tag-1" }, name: "Today" };
  const flattenedTags = [tag];

  it("persists the tag id under _ForecastBlessedTagIdentifier", () => {
    const settings = fakeSettings({});
    const result = runScript(
      forecastTagSetWithNameScript,
      { settings, flattenedTags },
      { tagId: "tag-1" },
    );
    expect(result).toEqual({ tagId: "tag-1", name: "Today" });
    expect(settings._raw(FORECAST_KEY)).toBe("tag-1");
  });

  it("clears by removing the override (null tagId)", () => {
    const settings = fakeSettings({ [FORECAST_KEY]: "tag-1" });
    const result = runScript(
      forecastTagSetWithNameScript,
      { settings, flattenedTags },
      { tagId: null },
    );
    expect(result).toEqual({ tagId: null, name: null });
    expect(settings._raw(FORECAST_KEY)).toBeUndefined();
  });

  it("returns NOT_FOUND without writing when the tag id is unknown", () => {
    const settings = fakeSettings({});
    const result = runScript<{ error: { code: string } }>(
      forecastTagSetWithNameScript,
      { settings, flattenedTags },
      { tagId: "nope" },
    );
    expect(result.error.code).toBe("NOT_FOUND");
    expect(settings._raw(FORECAST_KEY)).toBeUndefined();
  });

  it("set → read round-trips through the settings store", () => {
    const settings = fakeSettings({});
    const Tag = {
      byIdentifier: (id: string) => (id === tag.id.primaryKey ? tag : null),
    };
    runScript(forecastTagSetWithNameScript, { settings, flattenedTags }, { tagId: "tag-1" });
    const readBack = runScript(forecastTagWithNameScript, { settings, Tag });
    expect(readBack).toEqual({ tagId: "tag-1", name: "Today" });
  });
});
