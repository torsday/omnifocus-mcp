/**
 * JXA: list all folders, optionally filtered by parentId.
 *
 * Args (argv[0] JSON): { parentId?: string }
 * Returns JSON: { folders: Folder[] }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/folder.ts — Folder domain type
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/build_folder.js

  // OmniFocus 4.8.8: folder.parent() throws "Can't convert types." for
  // sub-folders. Build a reverse map (childId → parentId) by iterating each
  // folder's .folders() children instead — that API works correctly. Pass
  // the map into buildFolder via options.parentMap.
  const allFolders = ofApp.defaultDocument.flattenedFolders();
  const parentMap = {};
  for (let i = 0; i < allFolders.length; i++) {
    try {
      const subs = allFolders[i].folders();
      const pid = allFolders[i].id();
      for (let j = 0; j < subs.length; j++) {
        try {
          parentMap[subs[j].id()] = pid;
        } catch (_e) {
          /* OF 4.x: property access may not exist on all object types — default used */
        }
      }
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
  }

  const result = [];
  for (let i = 0; i < allFolders.length; i++) {
    const built = buildFolder(allFolders[i], { parentMap });
    // JxaTransport may send `parentId: null` for "no filter" — treat null and
    // undefined identically so those calls don't filter every folder out.
    // See #515 (tag_list had the same bug).
    if (args.parentId != null && built.parentId !== args.parentId) continue;
    result.push(built);
  }

  return JSON.stringify({ folders: result });
}
