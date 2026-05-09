/**
 * JXA: fetch one tag by ID.
 *
 * Args (argv[0] JSON): { id: string }
 * Returns JSON: { tag: Tag }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/tag.ts — Tag domain type
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/build_tag.js

  const doc = ofApp.defaultDocument;
  const docId = doc.id();
  const allTags = doc.flattenedTags();
  for (let i = 0; i < allTags.length; i++) {
    if (allTags[i].id() === args.id) {
      return JSON.stringify({ tag: buildTag(allTags[i], docId) });
    }
  }

  throw new Error(`Tag not found: ${args.id}`);
}
