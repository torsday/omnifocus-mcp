/**
 * JXA: update task fields.
 *
 * Args (argv[0] JSON): {
 *   id: string,
 *   name?: string, note?: string|null, flagged?: boolean,
 *   deferDate?: string|null, dueDate?: string|null,
 *   estimatedMinutes?: number|null, tagIds?: string[],
 *   sequential?: boolean, completedByChildren?: boolean
 * }
 * Returns JSON: { task: Task }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/task.ts — Task domain type
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

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
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let parentId = null;
    try {
      const pt = task.parentTask();
      if (pt) parentId = pt.id();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    const tagIds = [];
    try {
      const tags = task.tags();
      for (let i = 0; i < tags.length; i++) {
        try {
          tagIds.push(tags[i].id());
        } catch (_tagErr) {
          /* OF 4.x: individual tag specifier may throw on .id() — skip element */
        }
      }
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let deferDate = null;
    try {
      const dd = task.deferDate();
      if (dd) deferDate = dd.toISOString();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let dueDate = null;
    try {
      const due = task.dueDate();
      if (due) dueDate = due.toISOString();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let completedAt = null;
    try {
      const cd = task.completionDate();
      if (cd) completedAt = cd.toISOString();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let dropped = false;
    try {
      dropped = task.dropped();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let estimatedMinutes = null;
    try {
      const em = task.estimatedMinutes();
      if (em != null) estimatedMinutes = em;
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let note = null;
    try {
      note = task.note() || null;
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let noteHtml = null;
    try {
      if (task.noteHtml) noteHtml = task.noteHtml() || null;
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let flagged = false;
    try {
      flagged = task.flagged();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let completed = false;
    try {
      completed = task.completed();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let sequential = false;
    try {
      sequential = task.sequential();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let completedByChildren = false;
    try {
      completedByChildren = task.containsSingletonActions();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let available = false;
    try {
      available = task.available();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let blocked = false;
    try {
      blocked = task.blocked();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

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
      droppedAt: null,
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

  const allTasks = ofApp.defaultDocument.flattenedTasks();
  let found = null;
  for (let i = 0; i < allTasks.length; i++) {
    if (allTasks[i].id() === args.id) {
      found = allTasks[i];
      break;
    }
  }
  if (!found) throw new Error(`Task not found: ${args.id}`);

  if (args.name !== undefined) found.name = args.name;
  if (Object.hasOwn(args, "note")) {
    found.note = args.note ?? "";
  }
  if (args.flagged !== undefined) found.flagged = args.flagged;
  if (Object.hasOwn(args, "deferDate")) {
    found.deferDate = args.deferDate ? new Date(args.deferDate) : null;
  }
  if (Object.hasOwn(args, "dueDate")) {
    found.dueDate = args.dueDate ? new Date(args.dueDate) : null;
  }
  if (Object.hasOwn(args, "estimatedMinutes")) {
    found.estimatedMinutes = args.estimatedMinutes;
  }
  if (args.sequential !== undefined) found.sequential = args.sequential;
  if (args.completedByChildren !== undefined) {
    try {
      found.containsSingletonActions = args.completedByChildren;
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
  }

  if (args.tagIds !== undefined) {
    try {
      const currentTags = found.tags();
      for (let i = 0; i < currentTags.length; i++) {
        found.removeTag(currentTags[i]);
      }
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
    for (let i = 0; i < args.tagIds.length; i++) {
      try {
        const tag = ofApp.defaultDocument.flattenedTags.byId(args.tagIds[i]);
        found.addTag(tag);
      } catch (_e) {
        /* OF 4.x: property access may not exist on all object types — default used */
      }
    }
  }

  return JSON.stringify({ task: buildTask(found) });
}
