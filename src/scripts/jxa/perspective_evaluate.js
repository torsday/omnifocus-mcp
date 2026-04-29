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

    function buildRepetition(task) {
      try {
        const rr = task.repetitionRule();
        if (!rr) return null;
        return {
          method: rr.method(),
          unit: rr.unit(),
          steps: rr.steps(),
        };
      } catch (_e) {
        return null;
      }
    }

    function buildTask(task) {
      // See task_get.js — `cp.class()` throws on real projects in OF 4.x (#673).
      let projectId = null;
      try {
        const cp = task.containingProject();
        if (cp) {
          let isDocument = false;
          try {
            isDocument = cp.class() === "document";
          } catch (_classErr) {
            /* OF 4.x: real projects throw here */
          }
          if (!isDocument) projectId = cp.id();
        }
      } catch (_e) {}

      let parentId = null;
      try {
        const pt = task.parentTask();
        if (pt) parentId = pt.id();
      } catch (_e) {}

      const tagIds = [];
      try {
        const tags = task.tags();
        for (let i = 0; i < tags.length; i++) {
          tagIds.push(tags[i].id());
        }
      } catch (_e) {}

      let deferDate = null;
      try {
        const dd = task.deferDate();
        if (dd) deferDate = dd.toISOString();
      } catch (_e) {}

      let dueDate = null;
      try {
        const due = task.dueDate();
        if (due) dueDate = due.toISOString();
      } catch (_e) {}

      let completedAt = null;
      try {
        const cd = task.completionDate();
        if (cd) completedAt = cd.toISOString();
      } catch (_e) {}

      const droppedAt = null;
      let dropped = false;
      try {
        dropped = task.dropped();
      } catch (_e) {}

      let estimatedMinutes = null;
      try {
        const em = task.estimatedMinutes();
        if (em != null) estimatedMinutes = em;
      } catch (_e) {}

      let note = null;
      try {
        note = task.note() || null;
      } catch (_e) {}

      let noteHtml = null;
      try {
        if (task.noteHtml) noteHtml = task.noteHtml() || null;
      } catch (_e) {}

      let flagged = false;
      try {
        flagged = task.flagged();
      } catch (_e) {}

      let completed = false;
      try {
        completed = task.completed();
      } catch (_e) {}

      let sequential = false;
      try {
        sequential = task.sequential();
      } catch (_e) {}

      let completedByChildren = false;
      try {
        completedByChildren = task.containsSingletonActions();
      } catch (_e) {}

      let available = false;
      try {
        available = task.available();
      } catch (_e) {}

      let blocked = false;
      try {
        blocked = task.blocked();
      } catch (_e) {}

      return {
        id: task.id(),
        name: task.name(),
        note: note,
        noteHtml: noteHtml,
        projectId: projectId,
        parentId: parentId,
        tagIds: tagIds,
        deferDate: deferDate,
        dueDate: dueDate,
        estimatedMinutes: estimatedMinutes,
        flagged: flagged,
        completed: completed,
        completedAt: completedAt,
        dropped: dropped,
        droppedAt: droppedAt,
        available: available,
        blocked: blocked,
        sequential: sequential,
        completedByChildren: completedByChildren,
        repetition: buildRepetition(task),
        // Guard against "Can't get object." thrown when invoking these — see #498.

        createdAt: (() => {
          try {
            return task.creationDate().toISOString();
          } catch (_e) {
            return new Date().toISOString();
          }
        })(),

        modifiedAt: (() => {
          try {
            return task.modificationDate().toISOString();
          } catch (_e) {
            return new Date().toISOString();
          }
        })(),
      };
    }

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
