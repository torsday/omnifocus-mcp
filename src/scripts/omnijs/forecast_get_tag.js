/**
 * OmniJS: read the forecast-tag preference (the tag whose tasks always
 * appear on the Forecast view alongside dated items).
 *
 * Args injected as `globalThis.__args`: {} (no input)
 *
 * Returns JSON: { tagId: string | null }
 *   - `tagId` is the configured forecast tag's primary-key string when set
 *   - `null` when no forecast tag is configured (fresh OF install or cleared)
 *
 * @see #465
 */
(() => {
  // OmniJS exposes the preference as `Database.forecastTag`. Older docs
  // reference `Database.forecastTagID`; the property here is the actual Tag
  // object (or null), so we read `.id.primaryKey` from it.
  const tag = Database.forecastTag;
  return JSON.stringify({ tagId: tag === null ? null : tag.id.primaryKey });
})();
