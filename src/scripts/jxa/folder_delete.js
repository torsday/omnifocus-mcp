/**
 * JXA: delete a folder by ID. Refuses if the folder has projects or subfolders.
 *
 * Args (argv[0] JSON): { id: string }
 * Returns JSON: { id: string }
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

  const allFolders = ofApp.defaultDocument.flattenedFolders();
  let target = null;
  for (let i = 0; i < allFolders.length; i++) {
    if (allFolders[i].id() === args.id) {
      target = allFolders[i];
      break;
    }
  }
  if (!target) throw new Error(`Folder not found: ${args.id}`);

  const projectCount = target.projects ? target.projects().length : 0;
  const subfolderCount = target.folders ? target.folders().length : 0;
  if (projectCount > 0 || subfolderCount > 0) {
    throw new Error(
      `Folder is not empty (projects: ${projectCount}, subfolders: ${subfolderCount}). Remove contents before deleting.`,
    );
  }

  ofApp.delete(target);

  return JSON.stringify({ id: args.id });
}
