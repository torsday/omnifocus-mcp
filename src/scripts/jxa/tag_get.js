// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />

/**
 * JXA: fetch one tag by ID.
 *
 * Args (argv[0] JSON): { id: string }
 * Returns JSON: { tag: Tag }
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
  // @inline _helpers/lookup_or_throw.js

  const doc = ofApp.defaultDocument;
  const docId = doc.id();
  // byId() instead of a flattenedTags() linear scan (#788/#1081): O(1) bridge
  // lookup vs O(n) Apple Events. lookupOrThrow forces resolution and throws the
  // same "Tag not found: <id>" on a missing id.
  const tag = lookupOrThrow(doc.flattenedTags.byId(args.id), "Tag", args.id);
  return JSON.stringify({ tag: buildTag(tag, docId) });
}
