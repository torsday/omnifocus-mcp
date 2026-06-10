/**
 * perspective_evaluate.js — evaluate a custom OmniFocus perspective and
 * return its task list as domain `Task` objects.
 *
 * Called via the OmniJS transport (evaluateJavascript bridge).
 * Args injected as `globalThis.__args`:
 *   { identifier: string }
 *
 * Returns a JSON string: { tasks: Task[] } on success, or a JSON error
 * envelope `{ error: { code, message } }` for typed failures (Pro-gating,
 * unknown perspective identifier) that the caller maps to typed errors.
 *
 * Evaluation strategy (per Omni Automation): the perspective is set on the
 * front document window, and the resulting `content.rootNode.descendants`
 * are walked to collect every `Task` object. This mirrors what the user
 * would see if they switched to the perspective in the UI — the only API
 * surface OmniFocus exposes for perspective evaluation.
 *
 * @see src/adapter/omnijs/OmniJsTransport.ts — evaluateCustomPerspective()
 * @see src/domain/task.ts — Task domain type
 * @see docs/adr/0005-scripts-as-first-class-files.md
 */
(() => {
  const { identifier } = globalThis.__args;

  if (typeof Perspective === "undefined" || typeof Perspective.Custom === "undefined") {
    return JSON.stringify({
      error: { code: "FEATURE_REQUIRES_PRO", message: "Custom perspectives require OmniFocus Pro" },
    });
  }

  const persp = Perspective.Custom.byIdentifier(identifier);
  if (persp === null || persp === undefined) {
    return JSON.stringify({
      error: { code: "NOT_FOUND", message: `Custom perspective not found: ${identifier}` },
    });
  }

  const win = document.windows[0];
  win.perspective = persp;

  function isoOrNull(d) {
    return d ? d.toISOString() : null;
  }

  // OmniJS Task.RepetitionRule exposes only `ruleString` (the RFC 5545 RRULE,
  // e.g. "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH") and `method` (a
  // Task.RepetitionMethod enum value) — there are no `unit`/`steps` members.
  // Parse the RRULE into the canonical domain shape; keep in sync with the
  // JXA twin (src/scripts/jxa/_helpers/build_task.js buildRepetition).
  function buildRepetition(task) {
    try {
      const rr = task.repetitionRule;
      if (!rr) return null;

      // ruleString is the canonical signal; without it there is no rule to report.
      const recurrence = rr.ruleString;
      if (!recurrence || typeof recurrence !== "string") return null;

      // Method None means "does not repeat" — report no rule.
      if (rr.method === Task.RepetitionMethod.None) return null;

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

      // Map the enum to the domain method strings; default to fixed.
      let method = "fixed";
      if (rr.method === Task.RepetitionMethod.DueDate) method = "due-again";
      else if (rr.method === Task.RepetitionMethod.DeferUntilDate) method = "start-again";

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
              result.monthlyAnchor = { weekday: weekday, position: pos === -1 ? "last" : pos };
            }
          }
        }
      }

      return result;
    } catch (_e) {
      return null;
    }
  }

  function buildTask(task) {
    const tagIds = [];
    try {
      const tags = task.tags;
      for (let i = 0; i < tags.length; i++) tagIds.push(tags[i].id.primaryKey);
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let projectId = null;
    try {
      if (task.containingProject) projectId = task.containingProject.id.primaryKey;
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let parentId = null;
    try {
      if (task.parent && task.parent instanceof Task) parentId = task.parent.id.primaryKey;
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    // OmniJS has no `blocked`/`available`/`dropped` booleans on Task — the
    // computed state lives on `taskStatus` (a Task.Status enum value); map it
    // (same pattern as task_create.js). Next/DueSoon/Overdue are refinements
    // of Available, so all four count as available, matching JXA's
    // task.available().
    const status = task.taskStatus;

    return {
      id: task.id.primaryKey,
      name: task.name,
      note: task.note || null,
      noteHtml: null,
      projectId,
      parentId,
      tagIds,
      deferDate: isoOrNull(task.deferDate),
      dueDate: isoOrNull(task.dueDate),
      estimatedMinutes: task.estimatedMinutes ?? null,
      flagged: !!task.flagged,
      completed: !!task.completed,
      completedAt: isoOrNull(task.completionDate),
      dropped: status === Task.Status.Dropped,
      droppedAt: isoOrNull(task.dropDate),
      available:
        status === Task.Status.Available ||
        status === Task.Status.Next ||
        status === Task.Status.DueSoon ||
        status === Task.Status.Overdue,
      blocked: status === Task.Status.Blocked,
      sequential: !!task.sequential,
      completedByChildren: !!task.completedByChildren,
      repetition: buildRepetition(task),
      createdAt: isoOrNull(task.added) ?? new Date().toISOString(),
      modifiedAt: isoOrNull(task.modified) ?? new Date().toISOString(),
    };
  }

  const tasks = [];
  const seen = new Set();
  const walk = (node) => {
    if (!node) return;
    try {
      const obj = node.object;
      if (obj instanceof Task && !seen.has(obj.id.primaryKey)) {
        seen.add(obj.id.primaryKey);
        tasks.push(buildTask(obj));
      }
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
    const children = node.children || [];
    for (let i = 0; i < children.length; i++) walk(children[i]);
  };
  walk(win.content.rootNode);

  return JSON.stringify({ tasks });
})();
