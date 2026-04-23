/**
 * JXA: list all folders, optionally filtered by parentId.
 *
 * Args (argv[0] JSON): { parentId?: string }
 * Returns JSON: { folders: Folder[] }
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

  const allFolders = ofApp.defaultDocument.flattenedFolders();
  const result = [];

  for (let i = 0; i < allFolders.length; i++) {
    const built = buildFolder(allFolders[i]);
    if (args.parentId !== undefined && built.parentId !== args.parentId) continue;
    result.push(built);
  }

  return JSON.stringify({ folders: result });
}
