/**
 * OmniJS: read the forecast-tag preference *with its display name* in one
 * round-trip (#849).
 *
 * Replaces the two-call fanout `getForecastTag()` (OmniJS) + `getTag(id)`
 * (JXA) — `Database.forecastTag` is the live Tag object, so its `.name` is
 * available in the same script. Returning `{tagId, name}` here drops the
 * separate JXA `getTag` spawn entirely.
 *
 * Args injected as `globalThis.__args`: {} (no input)
 *
 * Returns JSON: { tagId: string | null, name: string | null }
 *   - both null when no forecast tag is configured (fresh OF install / cleared).
 *     `Database.forecastTag` returns `undefined` in this case on some OF
 *     builds and `null` on others, so the guard accepts both.
 *   - the orphan case (tag deleted while still configured) cannot occur here:
 *     `Database.forecastTag` only resolves to a live tag or empty, so name is
 *     always consistent with tagId.
 *
 * @see #465 / #599 (lever-4 name round-trip) / #849
 */
(() => {
  const tag = Database.forecastTag;
  if (tag === null || tag === undefined) return JSON.stringify({ tagId: null, name: null });
  return JSON.stringify({ tagId: tag.id.primaryKey, name: tag.name });
})();
