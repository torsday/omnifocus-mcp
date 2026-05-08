/**
 * JXA: fetch multiple tags by IDs.
 *
 * Args (argv[0] JSON): { ids: string[] }
 * Returns JSON: { tags: (Tag | null)[] }
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

  const idSet = {};
  for (let i = 0; i < args.ids.length; i++) {
    idSet[args.ids[i]] = null;
  }

  const allTags = ofApp.defaultDocument.flattenedTags();
  for (let i = 0; i < allTags.length; i++) {
    const tid = allTags[i].id();
    if (Object.hasOwn(idSet, tid)) {
      idSet[tid] = buildTag(allTags[i]);
    }
  }

  const results = [];
  for (let i = 0; i < args.ids.length; i++) {
    results.push(idSet[args.ids[i]]);
  }

  return JSON.stringify({ tags: results });
}
