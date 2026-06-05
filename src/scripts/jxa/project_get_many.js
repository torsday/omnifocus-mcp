// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: fetch multiple projects by IDs.
 *
 * Args (argv[0] JSON): { ids: string[] }
 * Returns JSON: { projects: (Project | null)[] }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/project.ts — Project domain type
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/build_project.js
  // @inline _helpers/lookup_or_throw.js

  const doc = ofApp.defaultDocument;

  // byId() per requested id instead of one full flattenedProjects() linear scan
  // (#788/#1085). lookupOrThrow forces resolution and throws on a missing id;
  // we catch that and emit `null`, preserving the (Project | null)[] contract.
  const results = [];
  for (let i = 0; i < args.ids.length; i++) {
    let project = null;
    try {
      project = buildProject(
        lookupOrThrow(doc.flattenedProjects.byId(args.ids[i]), "Project", args.ids[i]),
      );
    } catch (_e) {
      project = null;
    }
    results.push(project);
  }

  return JSON.stringify({ projects: results });
}
