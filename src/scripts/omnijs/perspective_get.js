/**
 * perspective_get.js — read a custom OmniFocus perspective's full configuration.
 *
 * Called via the OmniJS transport. Args injected as `globalThis.__args`:
 *   { identifier: string }
 *
 * Returns JSON on success:
 *   { perspective: { id, name, aggregation, rules, iconColor } }
 *
 * Or a typed error envelope:
 *   { error: { code, message } }
 *
 * Built-in perspectives are not supported here — this surface only exposes
 * the rich rule-tree for custom perspectives. The caller (router) must
 * gate on `kind: "custom"` from `perspective_list` before calling.
 *
 * Rule serialization: `archivedFilterRules` is already a plain-JS array of
 * rule atoms. Walk it recursively, copying only known own-property keys so
 * the output is stable across OmniFocus versions and JSON-safe.
 *
 * iconColor: OmniJS exposes `Color` objects with `red`/`green`/`blue`/`alpha`
 * accessors; serialize as `{ r, g, b, a }` in [0, 1] floats, or null when
 * the perspective has no custom color.
 *
 * @see src/adapter/omnijs/OmniJsTransport.ts — getCustomPerspective()
 * @see src/domain/perspective.ts — PerspectiveDetail
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

  // Rule atom keys observed on real OmniFocus perspectives. Unknown keys are
  // preserved verbatim under `unknown` so a future OF release exposing a new
  // rule type doesn't silently drop data.
  const KNOWN_ATOM_KEYS = [
    "actionAvailability",
    "actionStatus",
    "actionHasAllOfTags",
    "actionHasAnyOfTags",
    "actionHasNoProject",
    "actionHasDueDate",
    "actionHasDeferDate",
    "actionIsLeaf",
    "actionIsProject",
    "actionMatchingSearch",
    "actionWithinFocus",
  ];

  function serializeRule(rule) {
    if (rule === null || rule === undefined || typeof rule !== "object") {
      return null;
    }
    // Disabled-rule wrapper.
    if (Object.hasOwn(rule, "disabledRule")) {
      const inner = serializeRule(rule.disabledRule);
      return inner === null ? null : { disabledRule: inner };
    }
    // Aggregate (compound) rule.
    if (Object.hasOwn(rule, "aggregateType")) {
      const children = Array.isArray(rule.aggregateRules) ? rule.aggregateRules : [];
      return {
        aggregateType: String(rule.aggregateType),
        aggregateRules: children.map(serializeRule).filter((r) => r !== null),
      };
    }
    // Atom rule — copy known keys; preserve unknown keys under `unknown`.
    const out = {};
    const unknown = {};
    let hasUnknown = false;
    for (const key of Object.keys(rule)) {
      const value = rule[key];
      if (KNOWN_ATOM_KEYS.indexOf(key) >= 0) {
        out[key] = value;
      } else {
        unknown[key] = value;
        hasUnknown = true;
      }
    }
    if (hasUnknown) out.unknown = unknown;
    return out;
  }

  function serializeColor(c) {
    if (c === null || c === undefined) return null;
    try {
      const r = typeof c.red === "number" ? c.red : null;
      const g = typeof c.green === "number" ? c.green : null;
      const b = typeof c.blue === "number" ? c.blue : null;
      const a = typeof c.alpha === "number" ? c.alpha : 1;
      if (r === null || g === null || b === null) return null;
      return { r, g, b, a };
    } catch (_e) {
      return null;
    }
  }

  let rawRules;
  try {
    rawRules = persp.archivedFilterRules;
  } catch (_e) {
    rawRules = null;
  }
  const rules = Array.isArray(rawRules)
    ? rawRules.map(serializeRule).filter((r) => r !== null)
    : [];

  let aggregation = null;
  try {
    const a = persp.archivedTopLevelFilterAggregation;
    aggregation = a === null || a === undefined ? "all" : String(a);
  } catch (_e) {
    aggregation = "all";
  }

  let iconColor = null;
  try {
    iconColor = serializeColor(persp.iconColor);
  } catch (_e) {
    iconColor = null;
  }

  let id;
  try {
    id = persp.identifier;
  } catch (_e) {
    id = identifier;
  }

  return JSON.stringify({
    perspective: {
      id: String(id),
      name: String(persp.name),
      aggregation,
      rules,
      iconColor,
    },
  });
})();
