/**
 * OmniJS: set or clear the forecast-tag preference and return the post-set
 * state *with the tag name* in one round-trip (#849).
 *
 * Replaces the two-call fanout `setForecastTag(id)` (OmniJS) + `getTag(id)`
 * (JXA). The preference lives in the OmniJS `settings` store under the key
 * `_ForecastBlessedTagIdentifier` (verified live — `Database` has no
 * `forecastTag` property; assigning one is a per-invocation expando that
 * never persists). The stored value is the tag's `id.primaryKey`.
 *
 * Args injected as `globalThis.__args`:
 *   { tagId: string | null }
 *   - non-null → store the tag's id under the settings key
 *   - null     → clear (remove the override; the key reverts to its
 *                default "", the same state a UI clear reads back as)
 *
 * Returns JSON: { tagId: string | null, name: string | null }
 *   or { error: { code, message } } on failure (VALIDATION / NOT_FOUND).
 *
 * @see #465 / #599 / #849
 * @see src/scripts/omnijs/forecast_tag_with_name.js — the read path
 */
(() => {
  const { tagId } = globalThis.__args;

  if (tagId === null || tagId === undefined) {
    settings.setObjectForKey(null, "_ForecastBlessedTagIdentifier");
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

  settings.setObjectForKey(tag.id.primaryKey, "_ForecastBlessedTagIdentifier");
  return JSON.stringify({ tagId: tag.id.primaryKey, name: tag.name });
})();
