// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: switch the front window to a named perspective.
 *
 * Args (argv[0] JSON): { perspectiveName: string }
 * Returns JSON: { perspectiveName }
 *  or { error: { code: "NO_FRONT_WINDOW" | "NOT_FOUND", message } }
 *
 * Built-in perspectives (Inbox, Projects, Tags, Forecast, Flagged, Review, etc.)
 * and custom perspectives both work — JXA `Window.perspective` accepts either.
 *
 * @see GH issue 466
 * @see src/adapter/jxa/JxaTransport.ts — setWindowPerspective() caller
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  const wins = ofApp.windows();
  if (!wins || wins.length === 0) {
    return JSON.stringify({
      error: { code: "NO_FRONT_WINDOW", message: "OmniFocus has no front window" },
    });
  }

  const w = wins[0];

  // Look up the perspective by name. Both built-in and custom perspectives
  // appear in `perspectives()`. We match exact name — case-sensitive, matches
  // OF's own UX.
  const all = ofApp.perspectives();
  let target = null;
  for (let i = 0; i < all.length; i++) {
    if (all[i].name() === args.perspectiveName) {
      target = all[i];
      break;
    }
  }
  if (!target) {
    return JSON.stringify({
      error: {
        code: "NOT_FOUND",
        message: `Perspective not found: ${args.perspectiveName}`,
      },
    });
  }

  w.perspective = target;
  return JSON.stringify({ perspectiveName: args.perspectiveName });
}
