/**
 * OmniJS: read the forecast-tag preference *with its display name* in one
 * round-trip (#849).
 *
 * The Forecast tag preference lives in the OmniJS `settings` store under
 * the key `_ForecastBlessedTagIdentifier` (verified live — `Database` has
 * no `forecastTag` property; reading one always yields `undefined`). The
 * stored value is the tag's `id.primaryKey`; the cleared/default state is
 * the empty string.
 *
 * Args injected as `globalThis.__args`: {} (no input)
 *
 * Returns JSON: { tagId: string | null, name: string | null }
 *   - both null when no forecast tag is configured (fresh OF install /
 *     cleared) — the settings value is "" in that state.
 *   - both null when the stored identifier is orphaned (tag deleted while
 *     still configured): the Forecast perspective shows no tag in that
 *     state, so reporting the dangling id would claim a tag that no longer
 *     exists.
 *
 * @see #465 / #599 (lever-4 name round-trip) / #849
 */
(() => {
  const id = settings.objectForKey("_ForecastBlessedTagIdentifier");
  if (typeof id !== "string" || id === "") {
    return JSON.stringify({ tagId: null, name: null });
  }
  const tag = Tag.byIdentifier(id);
  if (!tag) return JSON.stringify({ tagId: null, name: null });
  return JSON.stringify({ tagId: tag.id.primaryKey, name: tag.name });
})();
