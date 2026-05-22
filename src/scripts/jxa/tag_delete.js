// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: delete a tag by ID.
 *
 * Args (argv[0] JSON): { id: string }
 * Returns JSON: { id: string }
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

  const allTags = ofApp.defaultDocument.flattenedTags();
  let target = null;
  for (let i = 0; i < allTags.length; i++) {
    if (allTags[i].id() === args.id) {
      target = allTags[i];
      break;
    }
  }
  if (!target) throw new Error(`Tag not found: ${args.id}`);

  ofApp.delete(target);

  return JSON.stringify({ id: args.id });
}
