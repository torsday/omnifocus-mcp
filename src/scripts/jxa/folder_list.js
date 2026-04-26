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

  // OmniFocus 4.8.8: folder.parent() throws "Can't convert types." for
  // sub-folders. Build a reverse map (childId → parentId) by iterating each
  // folder's .folders() children instead — that API works correctly.
  const allFolders = ofApp.defaultDocument.flattenedFolders();
  const parentMap = {};
  for (let i = 0; i < allFolders.length; i++) {
    try {
      const subs = allFolders[i].folders();
      const pid = allFolders[i].id();
      for (let j = 0; j < subs.length; j++) {
        try {
          parentMap[subs[j].id()] = pid;
        } catch (_e) {}
      }
    } catch (_e) {}
  }

  function buildFolder(folder) {
    const id = folder.id();
    const parentId = parentMap[id] !== undefined ? parentMap[id] : null;

    return {
      id: id,
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

  const result = [];
  for (let i = 0; i < allFolders.length; i++) {
    const built = buildFolder(allFolders[i]);
    if (args.parentId !== undefined && built.parentId !== args.parentId) continue;
    result.push(built);
  }

  return JSON.stringify({ folders: result });
}
