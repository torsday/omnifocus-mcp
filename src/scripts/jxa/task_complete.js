// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: mark a task complete.
 *
 * Args (argv[0] JSON): { id: string, completionDate?: string|null }
 * Returns JSON: { id: string }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/lookup_or_throw.js

  // byId() instead of a flattenedTasks() linear scan (#788/#1083); byId resolves
  // completed tasks fine (verified), so no scan fallback is needed.
  const found = lookupOrThrow(ofApp.defaultDocument.flattenedTasks.byId(args.id), "Task", args.id);

  ofApp.markComplete(found);

  if (args.completionDate) {
    try {
      // @ts-expect-error JXA accepts property-setter form on sdef properties; see _types/sdef-overrides.d.ts.
      found.completionDate = new Date(args.completionDate);
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
  }

  return JSON.stringify({ id: args.id });
}
