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

  // noteHtml is intentionally omitted from all task responses — use note_get_html
  // to retrieve HTML note content on demand. See perf issue #791.

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
    noteHtml: null,
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

// OmniFocus 4.x note (#1071): the JXA RepetitionRule specifier does NOT expose
// `method()` / `unit()` / `steps()` — those are undefined and throw
// "rr.method is not a function". The previous body called them and the
// try/catch swallowed the throw, so EVERY repetition read returned null even
// when a rule was set (the write was fixed separately in #938). The members
// that actually exist on OF 4.x are two string properties:
//   - `rr.recurrence`        — the RFC 5545 RRULE, e.g. "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH"
//   - `rr.repetitionMethod`  — a human-readable method name (see METHOD_BY_LABEL)
// So we parse the RRULE back into the canonical domain shape. This is the
// inverse of the FREQ_BY_UNIT / ICAL_DAYS / method maps in task_update.js;
// keep the two in sync.
function buildRepetition(task) {
  try {
    const rr = task.repetitionRule();
    if (!rr) return null;

    // recurrence is the canonical signal; without it there is no rule to report.
    const recurrence = rr.recurrence;
    if (!recurrence || typeof recurrence !== "string") return null;

    // Parse the RRULE "KEY=VALUE;KEY=VALUE" into a lookup.
    const parts = {};
    const segments = recurrence.split(";");
    for (let i = 0; i < segments.length; i++) {
      const eq = segments[i].indexOf("=");
      if (eq > 0) parts[segments[i].slice(0, eq)] = segments[i].slice(eq + 1);
    }

    const UNIT_BY_FREQ = {
      MINUTELY: "minutes",
      HOURLY: "hours",
      DAILY: "days",
      WEEKLY: "weeks",
      MONTHLY: "months",
      YEARLY: "years",
    };
    const unit = UNIT_BY_FREQ[parts.FREQ];
    if (!unit) return null; // unknown/absent FREQ — can't represent it faithfully

    const steps = parts.INTERVAL ? parseInt(parts.INTERVAL, 10) : 1;

    // repetitionMethod is a human string on OF 4.x — map it back to the enum.
    // "fixed repetition" -> fixed; "due after completion" -> due-again;
    // "start after completion" -> start-again. Default to fixed if unrecognized.
    const METHOD_BY_LABEL = {
      "fixed repetition": "fixed",
      "due after completion": "due-again",
      "start after completion": "start-again",
    };
    let method = "fixed";
    try {
      const label = rr.repetitionMethod;
      if (label && METHOD_BY_LABEL[label]) method = METHOD_BY_LABEL[label];
    } catch (_methodErr) {
      /* repetitionMethod absent — keep the fixed default */
    }

    const result = { method: method, unit: unit, steps: steps };

    // Weekly weekday list: BYDAY=MO,WE,FR (plain day codes, no position prefix).
    const WEEKDAY_BY_ICAL = {
      SU: "sunday",
      MO: "monday",
      TU: "tuesday",
      WE: "wednesday",
      TH: "thursday",
      FR: "friday",
      SA: "saturday",
    };
    if (unit === "weeks" && parts.BYDAY) {
      const codes = parts.BYDAY.split(",");
      const weekdays = [];
      for (let i = 0; i < codes.length; i++) {
        const name = WEEKDAY_BY_ICAL[codes[i]];
        if (name) weekdays.push(name);
      }
      if (weekdays.length > 0) result.weekdays = weekdays;
    }

    // Monthly anchor: either BYMONTHDAY=15 (day) or BYDAY=2TU / BYDAY=-1FR (position).
    if (unit === "months") {
      if (parts.BYMONTHDAY) {
        const day = parseInt(parts.BYMONTHDAY, 10);
        if (!Number.isNaN(day)) result.monthlyAnchor = { day: day };
      } else if (parts.BYDAY) {
        // Positional form: optional leading signed integer then the 2-letter day.
        const m = parts.BYDAY.match(/^(-?\d+)([A-Z]{2})$/);
        if (m) {
          const pos = parseInt(m[1], 10);
          const weekday = WEEKDAY_BY_ICAL[m[2]];
          if (weekday) {
            // MonthlyAnchor (src/domain/task.ts) only admits positions
            // 1..4 or "last" (-1). RRULE permits others (BYDAY=5TU, -2TU);
            // omit the anchor for those rather than emit a position the
            // RepetitionRuleSchema rejects when the rule is written back.
            if (pos === -1) {
              result.monthlyAnchor = { weekday: weekday, position: "last" };
            } else if (pos >= 1 && pos <= 4) {
              result.monthlyAnchor = { weekday: weekday, position: pos };
            }
          }
        }
      }
    }

    return result;
  } catch (_e) {
    return null;
  }
}
