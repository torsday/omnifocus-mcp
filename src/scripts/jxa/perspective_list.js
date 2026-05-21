// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />

/**
 * JXA: list all perspectives (built-in + custom).
 *
 * Args (argv[0] JSON): {} (no arguments)
 * Returns JSON: { perspectives: Perspective[] }
 *
 * Built-in perspectives have well-known stable IDs. Custom perspectives
 * are returned with their OF IDs and requiresPro: true.
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/perspective.ts — Perspective domain type
 */

/** @param {string[]} _argv — unused; this script takes no arguments. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(_argv) {
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  const BUILTIN_IDS = new Set([
    "inbox",
    "projects",
    "tags",
    "forecast",
    "flagged",
    "nearby",
    "review",
  ]);

  /** @type {Record<string, string>} */
  const BUILTIN_NAMES = {
    inbox: "Inbox",
    projects: "Projects",
    tags: "Tags",
    forecast: "Forecast",
    flagged: "Flagged",
    nearby: "Nearby",
    review: "Review",
  };

  const perspectives = [];

  // Add built-in perspectives (always available, in defined order)
  for (const id of BUILTIN_IDS) {
    perspectives.push({
      id,
      name: BUILTIN_NAMES[id],
      kind: "builtin",
      requiresPro: false,
      icon: null,
    });
  }

  // Add custom perspectives from the app
  try {
    const appPerspectives = ofApp.perspectives();
    for (let i = 0; i < appPerspectives.length; i++) {
      const p = appPerspectives[i];
      try {
        let id = null;
        let name = null;
        try {
          id = p.id();
        } catch (_e) {
          /* OF 4.x: property access may not exist on all object types — default used */
        }
        try {
          name = p.name();
        } catch (_e) {
          /* OF 4.x: property access may not exist on all object types — default used */
        }

        // Skip built-ins (they appear again here with different IDs in some OF versions)
        if (name !== null && Object.values(BUILTIN_NAMES).includes(name)) continue;
        if (id === null || name === null) continue;

        perspectives.push({
          id,
          name,
          kind: "custom",
          requiresPro: true,
          icon: null,
        });
      } catch (_e) {
        // Skip malformed perspective entries
      }
    }
  } catch (_e) {
    // Custom perspectives unavailable (e.g. OF standard edition)
  }

  return JSON.stringify({ perspectives });
}
