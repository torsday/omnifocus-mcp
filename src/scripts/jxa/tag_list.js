// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />

/**
 * JXA: list all tags, optionally filtered by parentId or status.
 *
 * Args (argv[0] JSON): { parentId?: string, status?: string }
 * Returns JSON: { tags: Tag[] }
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
  const allTags = doc.flattenedTags();
  const result = [];

  for (let i = 0; i < allTags.length; i++) {
    const tag = allTags[i];
    const built = buildTag(tag, docId);

    // JxaTransport sends `parentId: null` / `status: null` for "no filter"
    // (rather than omitting). Treat null and undefined identically here so
    // those calls don't filter every tag out — see #515.
    if (args.parentId != null && built.parentId !== args.parentId) continue;
    if (args.status != null && built.status !== args.status) continue;

    result.push(built);
  }

  return JSON.stringify({ tags: result });
}
