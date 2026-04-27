/**
 * OmniJS: convert a task to a project via Database.convertTasksToProjects().
 *
 * This operation is only available via OmniJS — JXA has no equivalent.
 * The task's persistent identifier is preserved on the resulting project
 * (i.e. `Project.byIdentifier(task.id.primaryKey)` resolves after conversion).
 *
 * Args injected as `globalThis.__args`:
 *   {
 *     id: string,           // task primary key
 *     folderId?: string,    // if set, place in this folder
 *     position?: "beginning" | "ending"  // default "ending"
 *   }
 *
 * Returns JSON: { projectId: string }
 *
 * @see src/tools/task/convertToProject.ts — handler
 * @see https://github.com/torsday/omnifocus-mcp/issues/525
 */
(() => {
  const { id, folderId, position } = globalThis.__args;

  if (!id) {
    return JSON.stringify({ error: { code: "VALIDATION", message: "id is required" } });
  }

  const task = flattenedTasks.filter((t) => t.id.primaryKey === id)[0];
  if (!task) {
    return JSON.stringify({ error: { code: "NOT_FOUND", message: `Task not found: ${id}` } });
  }

  // Resolve the position argument for convertTasksToProjects.
  // Valid positions: library.beginning, library.ending,
  //                 folder.children.beginning, folder.children.ending
  let pos;
  const atBeginning = position === "beginning";

  if (folderId != null) {
    const folder =
      library.folders.filter((f) => f.id.primaryKey === folderId)[0] ??
      flattenedFolders.filter((f) => f.id.primaryKey === folderId)[0];
    if (!folder) {
      return JSON.stringify({
        error: { code: "NOT_FOUND", message: `Folder not found: ${folderId}` },
      });
    }
    pos = atBeginning ? folder.children.beginning : folder.children.ending;
  } else {
    pos = atBeginning ? library.beginning : library.ending;
  }

  const results = convertTasksToProjects([task], pos);

  // convertTasksToProjects returns an array of Projects parallel to the input.
  const project = results[0];
  if (!project) {
    return JSON.stringify({
      error: { code: "CONVERSION_FAILED", message: "convertTasksToProjects returned no project" },
    });
  }

  return JSON.stringify({ projectId: project.id.primaryKey });
})();
