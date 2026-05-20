/**
 * JXA: create a folder, optionally under a parent folder.
 *
 * Args (argv[0] JSON): { name: string, parentId?: string }
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

  if (!args.name || args.name.trim() === "") {
    throw new Error("ValidationError: name is required and cannot be empty");
  }

  let newFolder;
  if (args.parentId) {
    const allFolders = ofApp.defaultDocument.flattenedFolders();
    let parentFolder = null;
    for (let i = 0; i < allFolders.length; i++) {
      if (allFolders[i].id() === args.parentId) {
        parentFolder = allFolders[i];
        break;
      }
    }
    if (!parentFolder) throw new Error(`Parent folder not found: ${args.parentId}`);
    // OmniFocus 4.x rejects `ofApp.make({ new: "folder", at: ... })` with
    // error -1728 (errAENoSuchObject). Use the specifier-push pattern instead.
    newFolder = ofApp.Folder({ name: args.name });
    parentFolder.folders.push(newFolder);
  } else {
    // Same fix for document-level folder creation.
    newFolder = ofApp.Folder({ name: args.name });
    ofApp.defaultDocument.folders.push(newFolder);
  }

  // The new folder's parent is known: either `args.parentId` (when supplied)
  // or null (document-level). Pass a single-entry parentMap so buildFolder
  // surfaces the correct parentage even on OF 4.8.8 where `folder.parent()`
  // throws for sub-folders (#515).
  const parentMap = args.parentId ? { [newFolder.id()]: args.parentId } : {};
  return JSON.stringify({ folder: buildFolder(newFolder, { parentMap }) });
}
