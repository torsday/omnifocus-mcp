/**
 * JXA: rename a folder.
 *
 * Args (argv[0] JSON): { id: string, name: string }
 * Returns JSON: { folder: Folder }
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

  // Build a reverse parentMap (childId → parentId) so buildFolder resolves
  // sub-folder parentage correctly under the OF 4.8.8 `folder.parent()` bug
  // (#515). Same scan that locates the target folder.
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

  let target = null;
  for (let i = 0; i < allFolders.length; i++) {
    if (allFolders[i].id() === args.id) {
      target = allFolders[i];
      break;
    }
  }
  if (!target) throw new Error(`Folder not found: ${args.id}`);

  target.name = args.name;

  return JSON.stringify({ folder: buildFolder(target, { parentMap }) });
}
