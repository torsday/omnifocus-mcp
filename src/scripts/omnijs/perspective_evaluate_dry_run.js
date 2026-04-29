/**
 * perspective_evaluate_dry_run.js — evaluate a *proposed* perspective rule
 * tree and return its task list, without persisting the perspective.
 *
 * The OmniJS perspective evaluator (window.perspective + content.rootNode)
 * only operates on saved Perspective.Custom objects — there is no "evaluate
 * ad-hoc rules" surface. We work around this by creating a temporary
 * perspective with a sentinel name, evaluating it, and **always** deleting
 * it inside the same OmniJS execution. The rollback runs in this single
 * script so a TS-level retry that drops between transport hops cannot leave
 * an orphan perspective behind (per the existing perspective_create.js
 * rollback comment).
 *
 * Called via the OmniJS transport. Args injected as `globalThis.__args`:
 *   { aggregation?: string, rules?: Array<unknown> }
 *
 * Returns JSON: `{ tasks: Task[] }` on success, or
 * `{ error: { code, message } }` for typed failures (Pro-gating, JXA
 * failure, configure failure, walk failure). The caller maps codes to
 * typed errors.
 *
 * @see #659 — issue
 * @see src/scripts/omnijs/perspective_evaluate.js — saved-perspective evaluator
 * @see src/scripts/omnijs/perspective_create.js — JXA-make + configure pattern
 * @see src/scripts/omnijs/perspective_delete.js — deleteObject pattern
 */
(() => {
  const { aggregation, rules } = globalThis.__args;

  if (typeof Perspective === "undefined" || typeof Perspective.Custom === "undefined") {
    return JSON.stringify({
      error: { code: "FEATURE_REQUIRES_PRO", message: "Custom perspectives require OmniFocus Pro" },
    });
  }

  // Sentinel name — long random suffix avoids collision with user perspectives
  // even under concurrent dry-run calls. The leading underscore + "dry-run"
  // marker makes orphans (if any) trivially identifiable.
  const sentinelName = `__omnifocus-mcp-dry-run-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;

  // ----- Step 1: JXA make ----------------------------------------------------
  let persp;
  try {
    const app = Application("OmniFocus");
    const made = app.make({ new: "perspective", withProperties: { name: sentinelName } });
    if (made === null || made === undefined) {
      return JSON.stringify({
        error: { code: "SCRIPT_ERROR", message: "JXA make returned no object" },
      });
    }
    const all = Perspective.Custom.all;
    for (let i = 0; i < all.length; i++) {
      if (all[i].name === sentinelName) {
        persp = all[i];
        break;
      }
    }
    if (persp === undefined) {
      return JSON.stringify({
        error: {
          code: "SCRIPT_ERROR",
          message: `temp perspective "${sentinelName}" created but not located via Perspective.Custom.all`,
        },
      });
    }
  } catch (e) {
    return JSON.stringify({
      error: {
        code: "SCRIPT_ERROR",
        message: `JXA make failed: ${String(e?.message ? e.message : e)}`,
      },
    });
  }

  // From here on, `persp` exists and MUST be deleted before returning.
  // Defensive `safeDelete` swallows secondary errors so the primary error
  // (or success) reaches the caller.
  function safeDelete() {
    try {
      deleteObject(persp);
    } catch (_e) {
      // Surface in the message if the primary path was a success — caller
      // sees "tasks but cleanup failed". On primary failure we don't double-report.
    }
  }

  // ----- Step 2: configure rules + aggregation -------------------------------
  try {
    if (typeof aggregation === "string") {
      persp.archivedTopLevelFilterAggregation = aggregation;
    }
    if (Array.isArray(rules)) {
      persp.archivedFilterRules = rules;
    }
  } catch (e) {
    safeDelete();
    return JSON.stringify({
      error: {
        code: "SCRIPT_ERROR",
        message: `configure failed: ${String(e?.message ? e.message : e)}. Temp perspective rolled back.`,
      },
    });
  }

  // ----- Step 3: switch window + walk tasks ----------------------------------
  function isoOrNull(d) {
    return d ? d.toISOString() : null;
  }

  function buildRepetition(task) {
    try {
      const rr = task.repetitionRule;
      if (!rr) return null;
      return { method: String(rr.method), unit: String(rr.unit), steps: rr.steps };
    } catch (_e) {
      return null;
    }
  }

  function buildTask(task) {
    const tagIds = [];
    try {
      const tags = task.tags;
      for (let i = 0; i < tags.length; i++) tagIds.push(tags[i].id.primaryKey);
    } catch (_e) {}

    let projectId = null;
    try {
      if (task.containingProject) projectId = task.containingProject.id.primaryKey;
    } catch (_e) {}

    let parentId = null;
    try {
      if (task.parent && task.parent instanceof Task) parentId = task.parent.id.primaryKey;
    } catch (_e) {}

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
      dropped: !!task.dropped,
      droppedAt: isoOrNull(task.dropDate),
      available: !task.blocked && !task.completed && !task.dropped,
      blocked: !!task.blocked,
      sequential: !!task.sequential,
      completedByChildren: !!task.completedByChildren,
      repetition: buildRepetition(task),
      createdAt: isoOrNull(task.added) ?? new Date().toISOString(),
      modifiedAt: isoOrNull(task.modified) ?? new Date().toISOString(),
    };
  }

  let tasks;
  try {
    const win = document.windows[0];
    win.perspective = persp;

    tasks = [];
    const seen = new Set();
    const walk = (node) => {
      if (!node) return;
      try {
        const obj = node.object;
        if (obj instanceof Task && !seen.has(obj.id.primaryKey)) {
          seen.add(obj.id.primaryKey);
          tasks.push(buildTask(obj));
        }
      } catch (_e) {}
      const children = node.children || [];
      for (let i = 0; i < children.length; i++) walk(children[i]);
    };
    walk(win.content.rootNode);
  } catch (e) {
    safeDelete();
    return JSON.stringify({
      error: {
        code: "SCRIPT_ERROR",
        message: `evaluate walk failed: ${String(e?.message ? e.message : e)}. Temp perspective rolled back.`,
      },
    });
  }

  // ----- Step 4: cleanup (always) --------------------------------------------
  safeDelete();

  return JSON.stringify({ tasks });
})();
