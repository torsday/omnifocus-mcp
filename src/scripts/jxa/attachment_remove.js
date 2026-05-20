/**
 * JXA: remove an attachment by ID from a task or project.
 *
 * Args (argv[0] JSON): { taskId?: string, projectId?: string, attachmentId: string }
 * Exactly one of taskId / projectId must be provided.
 *
 * Returns JSON: {}
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;
  const doc = ofApp.defaultDocument;

  function findOwner() {
    if (args.taskId) {
      const tasks = doc.flattenedTasks();
      for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].id() === args.taskId) return tasks[i];
      }
      throw new Error(`Task not found: ${args.taskId}`);
    }
    if (args.projectId) {
      const projects = doc.flattenedProjects();
      for (let i = 0; i < projects.length; i++) {
        if (projects[i].id() === args.projectId) return projects[i];
      }
      throw new Error(`Project not found: ${args.projectId}`);
    }
    throw new Error("One of taskId or projectId is required");
  }

  const owner = findOwner();
  const atts = owner.fileAttachments();
  let found = false;
  for (let i = 0; i < atts.length; i++) {
    if (atts[i].id() === args.attachmentId) {
      ofApp.delete(atts[i]);
      found = true;
      break;
    }
  }
  if (!found) {
    throw new Error(`Attachment not found: ${args.attachmentId}`);
  }

  return JSON.stringify({});
}
