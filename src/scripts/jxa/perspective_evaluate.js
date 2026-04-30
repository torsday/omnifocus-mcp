/**
 * JXA: evaluate a built-in OmniFocus perspective and return its task list.
 *
 * Args (argv[0] JSON): { "perspectiveId": "inbox" | "projects" | "tags" | "forecast" | "flagged" | "nearby" | "review" }
 * Returns JSON: { tasks: Task[] }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/task.ts — Task domain type
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  try {
    const args = JSON.parse(argv[0]);
    const perspectiveId = args.perspectiveId;
    const ofApp = Application("OmniFocus");
    ofApp.includeStandardAdditions = false;

    // Early returns for perspectives that can't be evaluated in script context
    if (perspectiveId === "review" || perspectiveId === "nearby") {
      return JSON.stringify({ tasks: [] });
    }

    // @inline _helpers/build_task.js

    const result = [];

    if (perspectiveId === "inbox") {
      // Inbox: tasks not yet assigned to a project
      const inboxTasks = ofApp.inboxTasks();
      for (let i = 0; i < inboxTasks.length; i++) {
        result.push(buildTask(inboxTasks[i]));
      }
    } else if (perspectiveId === "flagged") {
      // Flagged: flagged tasks that are not completed/dropped
      const allTasks = ofApp.flattenedTasks();
      for (let i = 0; i < allTasks.length; i++) {
        const t = allTasks[i];
        const built = buildTask(t);
        if (built.flagged && !built.completed && !built.dropped) {
          result.push(built);
        }
      }
    } else if (perspectiveId === "forecast") {
      // Forecast: tasks with dueDate <= end of today and not completed/dropped
      const now = new Date();
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const allTasks = ofApp.flattenedTasks();
      for (let i = 0; i < allTasks.length; i++) {
        const t = allTasks[i];
        const built = buildTask(t);
        if (built.dueDate && !built.completed && !built.dropped) {
          const due = new Date(built.dueDate);
          if (due <= endOfDay) {
            result.push(built);
          }
        }
      }
    } else if (perspectiveId === "projects") {
      // Projects: top-level tasks of active projects (not completed/dropped)
      const allTasks = ofApp.flattenedTasks();
      for (let i = 0; i < allTasks.length; i++) {
        const t = allTasks[i];
        const built = buildTask(t);
        if (built.projectId !== null && !built.completed && !built.dropped) {
          result.push(built);
        }
      }
    } else if (perspectiveId === "tags") {
      // Tags: tasks that have at least one tag and are not completed/dropped
      const allTasks = ofApp.flattenedTasks();
      for (let i = 0; i < allTasks.length; i++) {
        const t = allTasks[i];
        const built = buildTask(t);
        if (built.tagIds.length > 0 && !built.completed && !built.dropped) {
          result.push(built);
        }
      }
    }

    return JSON.stringify({ tasks: result });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}
