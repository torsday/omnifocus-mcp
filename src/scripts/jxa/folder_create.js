/**
 * JXA: create a folder, optionally under a parent folder.
 *
 * Args (argv[0] JSON): { name: string, parentId?: string }
 * Returns JSON: { folder: Folder }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/folder.ts — Folder domain type
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  function buildFolder(folder) {
    let parentId = null;
    try {
      const p = folder.parent();
      if (p && p.class() !== "document") parentId = p.id();
    } catch (_e) {}

    return {
      id: folder.id(),
      name: folder.name(),
      parentId: parentId,
      projectCount: folder.projects ? folder.projects().length : 0,
      subfolderCount: folder.folders ? folder.folders().length : 0,
      createdAt: folder.creationDate
        ? folder.creationDate().toISOString()
        : new Date().toISOString(),
      modifiedAt: folder.modificationDate
        ? folder.modificationDate().toISOString()
        : new Date().toISOString(),
    };
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
    newFolder = ofApp.make({
      new: "folder",
      at: parentFolder.folders.end,
      withProperties: { name: args.name },
    });
  } else {
    newFolder = ofApp.make({
      new: "folder",
      at: ofApp.defaultDocument.folders.end,
      withProperties: { name: args.name },
    });
  }

  return JSON.stringify({ folder: buildFolder(newFolder) });
}
