/**
 * perspective_update.js — partial-patch update of a custom OmniFocus
 * perspective.
 *
 * Called via the OmniJS transport. Args injected as `globalThis.__args`:
 *   { identifier, name?, aggregation?, rules?, iconColor? }
 *
 * Returns JSON: `{ id: string }` on success (echoes the identifier),
 * or `{ error: { code, message } }` for typed failures.
 *
 * Patch semantics:
 *   - Only fields present in args are written. Omitted fields leave the
 *     existing value unchanged.
 *   - `iconColor: null` clears any custom color back to the OmniFocus default.
 *   - `iconColor: { r, g, b, a }` writes a new color via Color.RGB(...).
 *   - `rules: []` clears the rule tree to "show everything" (the default).
 *
 * Built-in perspectives have no rule tree to patch — `Perspective.Custom
 * .byIdentifier` returns null for them, which the script reports as
 * NOT_FOUND. The MCP-tool layer rejects built-in ids as VALIDATION_ERROR
 * before calling the adapter, so callers should rarely reach this branch.
 *
 * No rollback dance: unlike create, an update does not have a shell to
 * roll back — failures leave the perspective in whatever state OmniFocus
 * persisted before the throw. Tests that simulate mid-patch failure should
 * gate on real OmniFocus behavior.
 *
 * @see #577, #618
 * @see src/adapter/omnijs/OmniJsTransport.ts — updateCustomPerspective()
 * @see src/scripts/omnijs/perspective_create.js — sibling create script
 */
(() => {
  const { identifier, name, aggregation, rules, iconColor } = globalThis.__args;

  if (typeof Perspective === "undefined" || typeof Perspective.Custom === "undefined") {
    return JSON.stringify({
      error: { code: "FEATURE_REQUIRES_PRO", message: "Custom perspectives require OmniFocus Pro" },
    });
  }

  if (typeof identifier !== "string" || identifier.length === 0) {
    return JSON.stringify({
      error: { code: "VALIDATION_ERROR", message: "identifier is required and must be non-empty" },
    });
  }

  const persp = Perspective.Custom.byIdentifier(identifier);
  if (persp === null || persp === undefined) {
    return JSON.stringify({
      error: { code: "NOT_FOUND", message: `Custom perspective not found: ${identifier}` },
    });
  }

  try {
    if (typeof name === "string") {
      if (name.length === 0) {
        return JSON.stringify({
          error: { code: "VALIDATION_ERROR", message: "name must be non-empty" },
        });
      }
      persp.name = name;
    }
    if (typeof aggregation === "string") {
      persp.archivedTopLevelFilterAggregation = aggregation;
    }
    if (Array.isArray(rules)) {
      // Same passthrough convention as perspective_create.js — the input
      // shape mirrors the read-side shape in perspective_get.js so
      // archivedFilterRules accepts it verbatim.
      persp.archivedFilterRules = rules;
    }
    if (iconColor === null) {
      // Explicit null clears the custom color back to the OmniFocus default.
      persp.iconColor = null;
    } else if (
      iconColor !== undefined &&
      typeof iconColor === "object" &&
      typeof iconColor.r === "number" &&
      typeof iconColor.g === "number" &&
      typeof iconColor.b === "number" &&
      typeof iconColor.a === "number"
    ) {
      persp.iconColor = Color.RGB(iconColor.r, iconColor.g, iconColor.b, iconColor.a);
    }
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.toLowerCase().indexOf("already") >= 0 || msg.toLowerCase().indexOf("duplicate") >= 0) {
      return JSON.stringify({
        error: { code: "VALIDATION_ERROR", message: `Duplicate perspective name: ${name}` },
      });
    }
    return JSON.stringify({
      error: { code: "SCRIPT_ERROR", message: msg },
    });
  }

  return JSON.stringify({ id: identifier });
})();
