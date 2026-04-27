/**
 * OmniJS: set or clear the forecast-tag preference.
 *
 * Args injected as `globalThis.__args`:
 *   { tagId: string | null }
 *   - `tagId` non-null  → set Database.forecastTag = <that tag>
 *   - `tagId` null      → clear (Database.forecastTag = null)
 *
 * Returns JSON: { tagId: string | null } — echoes what was applied
 *  or { error: { code, message } } on failure
 *
 * @see #465
 */
(() => {
  const { tagId } = globalThis.__args;

  if (tagId === null || tagId === undefined) {
    Database.forecastTag = null;
    return JSON.stringify({ tagId: null });
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
  return JSON.stringify({ tagId });
})();
