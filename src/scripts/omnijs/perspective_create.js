/**
 * perspective_create.js — create a new custom OmniFocus perspective.
 *
 * Called via the OmniJS transport. Args injected as `globalThis.__args`:
 *   { name, aggregation?, rules?, iconColor? }
 *
 * Returns JSON: `{ id: string }` on success (the new persistent identifier),
 * or `{ error: { code, message } }` for typed failures.
 *
 * Two-step write:
 *   1. JXA `make({ new: "perspective", withProperties: { name } })` to create
 *      the shell. JXA is the only API that creates a custom perspective —
 *      OmniJS has no factory for `Perspective.Custom`.
 *   2. OmniJS configures `archivedTopLevelFilterAggregation`,
 *      `archivedFilterRules`, and `iconColor` on the resulting object.
 *
 * Atomic rollback:
 *   If step 2 throws, the script calls `deleteObject(persp)` so the user is
 *   never left with a half-configured perspective. The rollback runs inside
 *   this same OmniJS execution — no TS-level try/finally that could itself
 *   fail between transport hops.
 *
 * Rule serialization:
 *   The input rule shape mirrors the read-side shape in `perspective_get.js`
 *   (#523/#569) so round-trips are lossless. Atom keys, aggregate
 *   `aggregateType` / `aggregateRules`, and `disabledRule` wrappers are
 *   passed through verbatim — `archivedFilterRules` accepts plain JS arrays
 *   of plain JS objects.
 *
 * iconColor:
 *   `{ r, g, b, a }` floats in [0, 1] are mapped to `Color.RGB(r, g, b, a)`,
 *   symmetric with the read serialization.
 *
 * @see #577, #617
 * @see src/adapter/omnijs/OmniJsTransport.ts — createCustomPerspective()
 * @see src/scripts/omnijs/perspective_get.js — serialization mirror
 */
(() => {
  const { name, aggregation, rules, iconColor } = globalThis.__args;

  if (typeof Perspective === "undefined" || typeof Perspective.Custom === "undefined") {
    return JSON.stringify({
      error: { code: "FEATURE_REQUIRES_PRO", message: "Custom perspectives require OmniFocus Pro" },
    });
  }

  if (typeof name !== "string" || name.length === 0) {
    return JSON.stringify({
      error: { code: "VALIDATION_ERROR", message: "name is required and must be non-empty" },
    });
  }

  // ----- Step 1: JXA make ----------------------------------------------------
  // Application("OmniFocus") inside OmniJS bridges to the JXA application
  // object. `make` is the only documented way to create a custom perspective.
  let persp;
  let identifier;
  try {
    const app = Application("OmniFocus");
    const made = app.make({
      new: "perspective",
      withProperties: { name },
    });
    // `make` returns a JXA reference. The persistent identifier is exposed
    // via the OmniJS-side wrapper, not the JXA reference, so re-fetch by
    // name to get the OmniJS object. Names are unique inside a database, so
    // a fresh lookup by name is unambiguous *immediately* after creation.
    if (made === null || made === undefined) {
      return JSON.stringify({
        error: { code: "SCRIPT_ERROR", message: "JXA make returned no object" },
      });
    }
    // Locate the OmniJS-side perspective by name. `Perspective.Custom.all`
    // is the documented enumeration; we filter by name to find the one we
    // just created.
    const all = Perspective.Custom.all;
    for (let i = 0; i < all.length; i++) {
      if (all[i].name === name) {
        persp = all[i];
        identifier = persp.identifier;
        break;
      }
    }
    if (persp === undefined) {
      return JSON.stringify({
        error: {
          code: "SCRIPT_ERROR",
          message: `created perspective named "${name}" but could not locate it via Perspective.Custom.all`,
        },
      });
    }
  } catch (e) {
    const msg = String(e?.message ? e.message : e);
    // OmniFocus rejects duplicate names with a recognisable message; surface
    // as VALIDATION_ERROR so the agent can react accordingly.
    if (msg.toLowerCase().indexOf("already") >= 0 || msg.toLowerCase().indexOf("duplicate") >= 0) {
      return JSON.stringify({
        error: { code: "VALIDATION_ERROR", message: `Duplicate perspective name: ${name}` },
      });
    }
    return JSON.stringify({
      error: { code: "SCRIPT_ERROR", message: `JXA make failed: ${msg}` },
    });
  }

  // ----- Step 2: OmniJS configure (with rollback on failure) -----------------
  try {
    if (typeof aggregation === "string") {
      persp.archivedTopLevelFilterAggregation = aggregation;
    }
    if (Array.isArray(rules)) {
      // archivedFilterRules accepts plain JS arrays of plain JS objects —
      // the same shape produced by perspective_get.js. Pass through verbatim.
      persp.archivedFilterRules = rules;
    }
    if (
      iconColor !== null &&
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
    // Atomic rollback — the shell exists but the configure step failed, so
    // delete the shell so the user is never left with a malformed
    // perspective. If rollback also fails, surface both errors.
    const configureMsg = String(e?.message ? e.message : e);
    try {
      deleteObject(persp);
    } catch (rollbackErr) {
      const rollbackMsg = String(rollbackErr?.message ? rollbackErr.message : rollbackErr);
      return JSON.stringify({
        error: {
          code: "SCRIPT_ERROR",
          message: `configure failed (${configureMsg}); rollback also failed (${rollbackMsg}). Shell perspective "${name}" may need manual deletion.`,
        },
      });
    }
    return JSON.stringify({
      error: {
        code: "SCRIPT_ERROR",
        message: `configure failed: ${configureMsg}. Shell perspective rolled back.`,
      },
    });
  }

  return JSON.stringify({ id: identifier });
})();
