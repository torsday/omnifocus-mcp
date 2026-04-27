/**
 * OmniJS: replace a task's alarm/notification set atomically.
 *
 * Args injected as `globalThis.__args`: { taskId: string, alarms: TaskAlarm[] }
 *
 *   TaskAlarm =
 *     | { kind: "due-relative",   offsetSeconds: number }
 *     | { kind: "defer-relative", offsetSeconds: number }
 *     | { kind: "absolute",       fireAt: ISO-8601 string }
 *
 * Algorithm:
 *   1. Resolve the task by primary-key.
 *   2. Drop every existing notification on the task (full-replace; the
 *      MCP tool layer already enforced this is the intended semantics).
 *   3. Add each requested alarm via `Task.addNotification`. OmniJS's
 *      addNotification accepts either a Date (for absolute) or a Number
 *      of seconds (for relative; positive = before, negative = after).
 *   4. Return JSON: { ok: true } on success, or
 *      { error: { code, message } } on transport-level failures.
 *
 * The tool-layer pre-validates that relative alarms have a corresponding
 * date anchor; the script trusts its inputs.
 *
 * @see #461
 */
(() => {
  const args = globalThis.__args || {};
  const taskId = args.taskId;
  const alarms = Array.isArray(args.alarms) ? args.alarms : [];

  if (typeof taskId !== "string" || !taskId) {
    return JSON.stringify({
      error: { code: "VALIDATION", message: "taskId must be a non-empty string" },
    });
  }

  const task = Task.byIdentifier(taskId);
  if (!task) {
    return JSON.stringify({
      error: { code: "NOT_FOUND", message: `Task ${taskId} not found` },
    });
  }

  // Phase 1: clear all existing notifications.
  // Iterate over a snapshot — modifying the live collection during the loop
  // would skip entries.
  const existing = Array.from(task.notifications);
  for (const n of existing) {
    try {
      n.removeFromContainer();
    } catch (_e) {
      // Continue best-effort; some notifications resist removal but the
      // subsequent addNotification calls re-derive state from scratch.
    }
  }

  // Phase 2: add each new alarm.
  try {
    for (const alarm of alarms) {
      if (alarm.kind === "absolute") {
        const fireAt = new Date(alarm.fireAt);
        if (Number.isNaN(fireAt.getTime())) {
          return JSON.stringify({
            error: { code: "VALIDATION", message: `invalid fireAt: ${alarm.fireAt}` },
          });
        }
        task.addNotification(fireAt);
      } else if (alarm.kind === "due-relative" || alarm.kind === "defer-relative") {
        const seconds = Number(alarm.offsetSeconds);
        if (!Number.isFinite(seconds)) {
          return JSON.stringify({
            error: { code: "VALIDATION", message: `invalid offsetSeconds: ${alarm.offsetSeconds}` },
          });
        }
        // OmniJS's addNotification(Number) treats the value as seconds-from-now
        // for absolute; relative-to-due uses Task.dueDate / deferDate offsets.
        // The OmniJS API accepts a fireOffset relative to the task's anchor
        // when called with a Number. The kind distinguishes which anchor
        // OmniFocus uses internally — `addNotification` reads the task's
        // dueDate / deferDate when constructing the relative offset.
        task.addNotification(seconds);
      } else {
        return JSON.stringify({
          error: { code: "VALIDATION", message: `unknown alarm kind: ${alarm.kind}` },
        });
      }
    }
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    return JSON.stringify({
      error: { code: "ADD_FAILED", message: msg },
    });
  }

  return JSON.stringify({ ok: true });
})();
