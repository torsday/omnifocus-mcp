/**
 * perspective_delete.js — delete a custom OmniFocus perspective by identifier.
 *
 * Called via the OmniJS transport. Args injected as `globalThis.__args`:
 *   { identifier: string }
 *
 * Returns JSON: `{ id: string }` on success (echoes the deleted identifier),
 * or `{ error: { code, message } }` for typed failures.
 *
 * Built-in perspectives cannot be deleted — `Perspective.Custom.byIdentifier`
 * returns null for them, which the script reports as NOT_FOUND. JXA cannot
 * delete custom perspectives; only OmniJS `deleteObject` works.
 *
 * @see src/adapter/omnijs/OmniJsTransport.ts — deleteCustomPerspective()
 */
(() => {
  const { identifier } = globalThis.__args;

  if (typeof Perspective === "undefined" || typeof Perspective.Custom === "undefined") {
    return JSON.stringify({
      error: { code: "FEATURE_REQUIRES_PRO", message: "Custom perspectives require OmniFocus Pro" },
    });
  }

  const persp = Perspective.Custom.byIdentifier(identifier);
  if (persp === null || persp === undefined) {
    return JSON.stringify({
      error: { code: "NOT_FOUND", message: `Custom perspective not found: ${identifier}` },
    });
  }

  try {
    deleteObject(persp);
  } catch (e) {
    return JSON.stringify({
      error: { code: "SCRIPT_ERROR", message: String(e?.message ? e.message : e) },
    });
  }

  return JSON.stringify({ id: identifier });
})();
