/**
 * JXA: move a project to a folder (or to the root if folderId is null).
 *
 * Args (argv[0] JSON): { id: string, folderId?: string|null }
 * Returns JSON: { id: string }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/project.ts — Project domain type
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  const allProjects = ofApp.defaultDocument.flattenedProjects();
  let target = null;
  for (let i = 0; i < allProjects.length; i++) {
    if (allProjects[i].id() === args.id) {
      target = allProjects[i];
      break;
    }
  }
  if (!target) throw new Error(`Project not found: ${args.id}`);

  if (args.folderId) {
    // Resolve via flattenedFolders iteration (top-level `folders` excludes
    // nested ones; `byId(...)` returns a lazy specifier whose subsequent
    // `.projects.end` is nil — same JXA quirk as #674's lookupOrThrow).
    // Mirroring the same iteration the project lookup above uses.
    const allFolders = ofApp.defaultDocument.flattenedFolders();
    let folder = null;
    for (let i = 0; i < allFolders.length; i++) {
      if (allFolders[i].id() === args.folderId) {
        folder = allFolders[i];
        break;
      }
    }
    if (!folder) throw new Error(`Folder not found: ${args.folderId}`);
    target.move({ to: folder.projects.end });
  } else {
    target.move({ to: ofApp.defaultDocument.projects.end });
  }

  return JSON.stringify({ id: args.id });
}
