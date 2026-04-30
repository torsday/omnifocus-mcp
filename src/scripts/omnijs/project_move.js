/**
 * OmniJS: move a project to a different folder, or to the library root
 * (when `folderId` is null).
 *
 * Routes through OmniJS rather than JXA per ADR-0019: JXA's
 * `target.move({ to: folder.projects.end })` silently fails (with
 * "Attempted to move data objects to a nil container") on projects /
 * folders that were created via the OmniJS path — which is now every
 * project after the createProject migration in #681's first slice.
 * OmniJS's `moveSections([proj], destination)` operates on persistent
 * `id.primaryKey` lookups and works across both transports.
 *
 * Sibling of `task_move.js` (which has been OmniJS-routed since #19).
 *
 * Args injected as `globalThis.__args`:
 *   {
 *     id: string,           // project's primary key
 *     folderId: string|null // target folder, or null for library root
 *   }
 *
 * Returns JSON: { id: string }
 *
 * @see src/adapter/omnijs/OmniJsTransport.ts — caller
 * @see docs/adr/0019-cross-transport-id-interoperability.md — routing rationale
 */
(() => {
  const args = globalThis.__args;

  if (!args.id) {
    return JSON.stringify({
      error: { code: "VALIDATION", message: "id is required" },
    });
  }

  const proj = flattenedProjects.filter((p) => p.id.primaryKey === args.id)[0];
  if (!proj) {
    return JSON.stringify({
      error: { code: "NOT_FOUND", message: `Project not found: ${args.id}` },
    });
  }

  // Resolve destination. `moveSections` accepts a folder (puts the project
  // at the end of that folder's children) or `library` (puts at the library
  // root level). The library object is itself the root container.
  let destination;
  if (args.folderId !== null && args.folderId !== undefined) {
    const folder = flattenedFolders.filter((f) => f.id.primaryKey === args.folderId)[0];
    if (!folder) {
      return JSON.stringify({
        error: { code: "NOT_FOUND", message: `Folder not found: ${args.folderId}` },
      });
    }
    destination = folder;
  } else {
    destination = library;
  }

  moveSections([proj], destination);

  return JSON.stringify({ id: args.id });
})();
