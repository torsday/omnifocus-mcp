// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: update mutable fields on an existing tag.
 *
 * Args (argv[0] JSON): { id: string, name?: string, status?: string, allowsNextAction?: boolean }
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
  // byId() instead of a flattenedTags() linear scan (#788/#1081).
  const target = lookupOrThrow(doc.flattenedTags.byId(args.id), "Tag", args.id);

  if (args.name !== undefined) target.name = args.name;
  if (args.status !== undefined) {
    // Normalize from domain format to JXA format
    const jxaStatus = args.status === "on-hold" ? "on hold" : args.status;
    target.status = jxaStatus;
  }
  if (args.allowsNextAction !== undefined) target.allowsNextAction = args.allowsNextAction;

  return JSON.stringify({ tag: buildTag(target, docId) });
}
