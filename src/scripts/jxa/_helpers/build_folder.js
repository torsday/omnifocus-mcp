/**
 * Canonical buildFolder helper for JXA scripts.
 *
 * Inlined into consumer scripts via the `// @inline _helpers/build_folder.js`
 * directive expanded by scriptInlinerPlugin (ADR-0020). This file is not
 * loaded as a module at runtime — it is spliced as raw source into each
 * consumer's bundled string before `osascript` evaluates it.
 *
 * Shape and guards merge the prior 4 copies (folder_create, folder_get,
 * folder_list, folder_update) preserving every issue-referenced fix verbatim:
 *
 *   - #515 / OF 4.8.8 — `folder.parent()` throws "Can't convert types" for
 *     sub-folders. folder_list worked around this by precomputing a reverse
 *     `parentMap` (childId → parentId) via each folder's `.folders()`
 *     children — that API works correctly. Consumers that have already
 *     scanned `flattenedFolders()` (folder_get, folder_list, folder_update)
 *     pass that map via `options.parentMap`. Consumers without a map (e.g.
 *     folder_create operating on a fresh specifier) fall back to the
 *     `folder.parent()` try/catch path.
 *   - #498 — `creationDate()` and `modificationDate()` may be truthy
 *     functions even on folders where invocation throws "Can't get object."
 *     The call must be guarded, not just the property reference. The same
 *     consideration applies to `projects()` and `folders()` count
 *     invocations.
 *
 * @param {object} folder — JXA Folder specifier
 * @param {object} [options]
 * @param {Record<string,string>} [options.parentMap] — childId → parentId
 *   reverse map. When supplied, parentId resolves via map lookup instead of
 *   `folder.parent()`. Required for correct sub-folder parentage on OF 4.8.8.
 * @returns {object} canonical Folder shape per `src/domain/folder.ts`
 */
// biome-ignore lint/correctness/noUnusedVariables: inlined into JXA consumers via @inline directive (ADR-0020).
function buildFolder(folder, options) {
  options = options || {};

  let parentId = null;
  if (options.parentMap) {
    const pid = options.parentMap[folder.id()];
    if (pid !== undefined) parentId = pid;
  } else {
    // Fallback for callers without a precomputed map. Note: on OF 4.8.8 this
    // silently returns null for sub-folders (the parent() call throws "Can't
    // convert types"); pass options.parentMap to avoid that.
    try {
      const p = folder.parent();
      if (p && p.class() !== "document") parentId = p.id();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
  }

  let projectCount = 0;
  try {
    projectCount = folder.projects().length;
  } catch (_e) {
    /* OF 4.x: property access may not exist on all object types — default used */
  }

  let subfolderCount = 0;
  try {
    subfolderCount = folder.folders().length;
  } catch (_e) {
    /* OF 4.x: property access may not exist on all object types — default used */
  }

  // Guard against "Can't get object." thrown when invoking these — see #498.
  let createdAt;
  try {
    createdAt = folder.creationDate().toISOString();
  } catch (_e) {
    createdAt = new Date().toISOString();
  }

  let modifiedAt;
  try {
    modifiedAt = folder.modificationDate().toISOString();
  } catch (_e) {
    modifiedAt = new Date().toISOString();
  }

  return {
    id: folder.id(),
    name: folder.name(),
    parentId: parentId,
    projectCount: projectCount,
    subfolderCount: subfolderCount,
    createdAt: createdAt,
    modifiedAt: modifiedAt,
  };
}
