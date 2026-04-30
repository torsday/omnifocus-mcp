/**
 * Canonical buildTask + buildRepetition helpers for JXA scripts.
 *
 * Inlined into consumer scripts via the `// @inline _helpers/build_task.js`
 * directive expanded by scriptInlinerPlugin (ADR-0020). This file is not
 * loaded as a module at runtime — it is spliced as raw source into each
 * consumer's bundled string before `osascript` evaluates it.
 *
 * Shape and guards merge the prior 8 copies (task_get, task_list, task_create,
 * task_update, task_search, task_get_many, forecast_get, perspective_evaluate)
 * preserving every issue-referenced fix verbatim:
 *
 *   - #673 — `containingProject().class()` throws "Can't convert types" on
 *     real Project specifiers in OF 4.x; only the document responds. Treat
 *     the throw as "is a real project" so projectId resolves correctly.
 *   - #682 — per-element tag guard: a single bad tag must not abort the loop
 *     and zero-out tagIds, which would silently exclude the task from
 *     tagId-filter results.
 *   - #498 — `creationDate()` and `modificationDate()` may be truthy
 *     functions even on tasks where invocation throws "Can't get object."
 *     The call must be guarded, not just the property reference.
 *
 * @param {object} task — JXA Task specifier
 * @param {object} [options]
 * @param {boolean} [options.effectiveAvailability=false] — when true, use
 *   `task.effectivelyAvailable()` (accounts for parent state, defer dates,
 *   sequential blocks) instead of `task.available()`. The forecast and
 *   search consumers want this; the rest want raw availability.
 * @returns {object} canonical Task shape per `src/domain/task.ts`
 */
// biome-ignore lint/correctness/noUnusedVariables: inlined into JXA consumers via @inline directive (ADR-0020).
function buildTask(task, options) {
  options = options || {};

  // OmniFocus 4.x note (#673): on a real Project specifier returned by
  // `task.containingProject()`, calling `.class()` throws "Can't convert
  // types". Only the document responds to `.class()` successfully. So:
  // treat a `.class()` throw as "is a real project", a successful return
  // as "is something else (document) — skip". The previous one-liner
  // (`cp.class() !== "document"`) let the throw escape the if-condition
  // and the outer try/catch swallowed the whole block, leaving projectId
  // null even when the task was correctly assigned to a project.
  let projectId = null;
  try {
    const cp = task.containingProject();
    if (cp) {
      let isDocument = false;
      try {
        isDocument = cp.class() === "document";
      } catch (_classErr) {
        /* OF 4.x: real projects throw here — leave isDocument false */
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
      // Guard per-element: a single bad tag object must not abort the loop
      // and zero-out all tagIds, which would silently exclude this task
      // from tagId-filter results (see #682).
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
    if (options.effectiveAvailability) {
      // task_search, forecast_get: "actionable right now" semantic —
      // accounts for parent state, defer dates, sequential blocks.
      available = task.effectivelyAvailable ? task.effectivelyAvailable() : false;
    } else {
      available = task.available();
    }
  } catch (_e) {
    /* OF 4.x: property access may not exist on all object types — default used */
  }

  let blocked = false;
  try {
    blocked = task.blocked();
  } catch (_e) {
    /* OF 4.x: property access may not exist on all object types — default used */
  }

  // Guard against "Can't get object." thrown when invoking these — see #498.
  // JXA reports creationDate/modificationDate as truthy functions even on
  // tasks where invocation throws. The call must be guarded, not just the
  // property reference.
  let createdAt;
  try {
    createdAt = task.creationDate().toISOString();
  } catch (_e) {
    createdAt = new Date().toISOString();
  }

  let modifiedAt;
  try {
    modifiedAt = task.modificationDate().toISOString();
  } catch (_e) {
    modifiedAt = new Date().toISOString();
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
    createdAt: createdAt,
    modifiedAt: modifiedAt,
  };
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
