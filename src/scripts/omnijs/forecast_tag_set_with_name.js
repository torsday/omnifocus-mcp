/**
 * OmniJS: set or clear the forecast-tag preference and return the post-set
 * state *with the tag name* in one round-trip (#849).
 *
 * Replaces the two-call fanout `setForecastTag(id)` (OmniJS) + `getTag(id)`
 * (JXA). Setting `Database.forecastTag` gives us the live Tag object back, so
 * its `.name` comes free — no separate JXA `getTag` spawn.
 *
 * Args injected as `globalThis.__args`:
 *   { tagId: string | null }
 *   - non-null → set Database.forecastTag = <that tag>
 *   - null     → clear (Database.forecastTag = null)
 *
 * Returns JSON: { tagId: string | null, name: string | null }
 *   or { error: { code, message } } on failure (VALIDATION / NOT_FOUND).
 *
 * @see #465 / #599 / #849
 */
(() => {
  const { tagId } = globalThis.__args;

  if (tagId === null || tagId === undefined) {
    Database.forecastTag = null;
    return JSON.stringify({ tagId: null, name: null });
  }

  if (typeof tagId !== "string") {
    return JSON.stringify({
      error: { code: "VALIDATION", message: "tagId must be a string or null" },
    });
  }

  const tag = flattenedTags.filter((t) => t.id.primaryKey === tagId)[0];
  if (!tag) {
    return JSON.stringify({
      error: { code: "NOT_FOUND", message: `Tag not found: ${tagId}` },
    });
  }

  Database.forecastTag = tag;
  return JSON.stringify({ tagId: tag.id.primaryKey, name: tag.name });
})();
