/**
 * JXA: fetch one folder by ID.
 *
 * Args (argv[0] JSON): { id: string }
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
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

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

  const allFolders = ofApp.defaultDocument.flattenedFolders();
  for (let i = 0; i < allFolders.length; i++) {
    if (allFolders[i].id() === args.id) {
      return JSON.stringify({ folder: buildFolder(allFolders[i]) });
    }
  }

  throw new Error(`Folder not found: ${args.id}`);
}
