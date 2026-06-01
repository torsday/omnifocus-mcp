// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: update task fields.
 *
 * Args (argv[0] JSON): {
 *   id: string,
 *   name?: string, note?: string|null, flagged?: boolean,
 *   deferDate?: string|null, dueDate?: string|null,
 *   estimatedMinutes?: number|null, tagIds?: string[],
 *   sequential?: boolean, completedByChildren?: boolean,
 *   repetition?: RepetitionRule|null
 * }
 * Returns JSON: { task: Task }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/task.ts — Task domain type
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/build_task.js

  const allTasks =
    ofApp.defaultDocument.flattenedTasks(); /* narrow-scan-ok: must resolve task by id; no scope hint available */
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
    // @ts-expect-error — sdef property setter; JXA accepts assignment, generator emits method signature only.
    found.deferDate = args.deferDate ? new Date(args.deferDate) : null;
  }
  if (Object.hasOwn(args, "dueDate")) {
    // @ts-expect-error — sdef property setter; JXA accepts assignment, generator emits method signature only.
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

  if (Object.hasOwn(args, "repetition")) {
    // OmniFocus 4.x: JXA assignment to `task.repetitionRule` silently fails (#938) —
    // the property accepts the write without error but the rule never persists.
    // OmniJS's `Task.RepetitionRule` constructor and `task.repetitionRule =` setter
    // are reliable, so delegate via evaluateJavascript. The rule string is RFC 5545
    // RRULE: FREQ + INTERVAL plus optional BYDAY (weekly) and BYMONTHDAY / BYDAY
    // with position (monthly anchor). A null rule clears the repetition.
    const rule = args.repetition;
    let omniJsScript;
    if (rule === null) {
      omniJsScript =
        "(() => {" +
        "  const t = Task.byIdentifier(" +
        JSON.stringify(args.id) +
        ");" +
        "  if (!t) return;" +
        "  t.repetitionRule = null;" +
        "})()";
    } else {
      /** @type {Record<string, string>} */
      const FREQ_BY_UNIT = {
        minutes: "MINUTELY",
        hours: "HOURLY",
        days: "DAILY",
        weeks: "WEEKLY",
        months: "MONTHLY",
        years: "YEARLY",
      };
      /** @type {Record<string, string>} */
      const ICAL_DAYS = {
        sunday: "SU",
        monday: "MO",
        tuesday: "TU",
        wednesday: "WE",
        thursday: "TH",
        friday: "FR",
        saturday: "SA",
      };
      // #1071: OF 4.x `Task.RepetitionMethod` has only None / Fixed /
      // DeferUntilDate / DueDate — there is no `Start` member. A prior mapping
      // of start-again to a `Start` member resolved to undefined, so
      // `new Task.RepetitionRule(rule, undefined)` silently persisted
      // start-again rules as Fixed. The correct member for "start again after
      // completion" (sdef enumerator FRmS) is DeferUntilDate.
      /** @type {Record<string, string>} */
      const METHOD_BY_NAME = {
        fixed: "Fixed",
        "start-again": "DeferUntilDate",
        "due-again": "DueDate",
      };
      const freq = FREQ_BY_UNIT[rule.unit];
      const methodEnum = METHOD_BY_NAME[rule.method];
      if (!freq) throw new Error(`Unsupported repetition unit: ${rule.unit}`);
      if (!methodEnum) throw new Error(`Unsupported repetition method: ${rule.method}`);
      const parts = [`FREQ=${freq}`, `INTERVAL=${rule.steps}`];
      if (rule.unit === "weeks" && Array.isArray(rule.weekdays) && rule.weekdays.length > 0) {
        const codes = [];
        for (let i = 0; i < rule.weekdays.length; i++) {
          const c = ICAL_DAYS[rule.weekdays[i]];
          if (c) codes.push(c);
        }
        if (codes.length > 0) parts.push(`BYDAY=${codes.join(",")}`);
      }
      if (rule.unit === "months" && rule.monthlyAnchor) {
        const a = rule.monthlyAnchor;
        if (typeof a.day === "number") {
          parts.push(`BYMONTHDAY=${a.day}`);
        } else if (a.weekday && a.position !== undefined) {
          const dayCode = ICAL_DAYS[a.weekday];
          const pos = a.position === "last" ? -1 : a.position;
          if (dayCode && typeof pos === "number") parts.push(`BYDAY=${pos}${dayCode}`);
        }
      }
      const ruleString = parts.join(";");
      omniJsScript =
        "(() => {" +
        "  const t = Task.byIdentifier(" +
        JSON.stringify(args.id) +
        ");" +
        "  if (!t) return;" +
        "  t.repetitionRule = new Task.RepetitionRule(" +
        JSON.stringify(ruleString) +
        ", Task.RepetitionMethod." +
        methodEnum +
        ");" +
        "})()";
    }
    ofApp.evaluateJavascript(omniJsScript);
  }

  if (args.tagIds !== undefined) {
    // OmniFocus 4.x: JXA's task.addTag(tag) / task.removeTag(tag) silently
    // no-op on existing tasks resolved by id (#716) — the call returns without
    // error but no row is written to the underlying SQLite TaskToTag table.
    // OmniJS's Task.addTag / Task.removeTag are reliable, so delegate the
    // tag-set replacement to OmniJS via evaluateJavascript. Tag IDs missing
    // from the OmniJS store are silently skipped (matches caller-layer
    // semantics in src/tools/task/update.ts which validates existence first).
    const omniJsScript =
      "(() => {" +
      "  const t = Task.byIdentifier(" +
      JSON.stringify(args.id) +
      ");" +
      "  if (!t) return;" +
      "  const desired = " +
      JSON.stringify(args.tagIds) +
      ";" +
      "  const existing = t.tags.slice();" +
      "  for (let i = 0; i < existing.length; i++) t.removeTag(existing[i]);" +
      "  for (let i = 0; i < desired.length; i++) {" +
      "    const tg = Tag.byIdentifier(desired[i]);" +
      "    if (tg) t.addTag(tg);" +
      "  }" +
      "})()";
    ofApp.evaluateJavascript(omniJsScript);
  }

  return JSON.stringify({ task: buildTask(found) });
}
