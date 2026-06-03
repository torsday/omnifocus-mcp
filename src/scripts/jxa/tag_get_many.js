// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: fetch multiple tags by IDs.
 *
 * Args (argv[0] JSON): { ids: string[] }
 * Returns JSON: { tags: (Tag | null)[] }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/tag.ts — Tag domain type
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/build_tag.js

  const doc = ofApp.defaultDocument;
  const docId = doc.id();

  // byId() per requested id instead of one full flattenedTags() linear scan
  // (#788/#1081). Each byId() is an O(1) bridge lookup; a missing id resolves
  // to a -1728 specifier whose `.id()` throws — caught here as `null`, which
  // preserves the (Tag | null)[] contract (get_many never throws on a miss).
  const results = [];
  for (let i = 0; i < args.ids.length; i++) {
    let tag = null;
    try {
      const spec = doc.flattenedTags.byId(args.ids[i]);
      spec.id(); // force resolution; throws on a non-existent id
      tag = buildTag(spec, docId);
    } catch (_e) {
      tag = null;
    }
    results.push(tag);
  }

  return JSON.stringify({ tags: results });
}
