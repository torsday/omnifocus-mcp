// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: set a project's next review date.
 *
 * The third axis of OmniFocus's review schedule (the others being
 * reviewIntervalDays and lastReviewDate). Setting nextReviewDate directly
 * lets agents reschedule a review independent of the recurring interval —
 * "push the Q3 review to next Monday" without mutating the cadence.
 *
 * Args (argv[0] JSON):
 *   { id: string, nextReviewDate: string | null }
 *   - `nextReviewDate` ISO-8601 → set to that date
 *   - `nextReviewDate` null     → reset to the interval-derived schedule.
 *     The sdef documents null assignment as "set the review date based off
 *     the last review date and review interval", and a project's review
 *     interval itself cannot be removed (assigning null throws "Invalid
 *     review interval") — OmniFocus has no unscheduled state, so a true
 *     clear is unrepresentable. Verified live on OF 4.8.8.
 *
 * Returns JSON: { id: string }
 *
 * Past-dated values are allowed by OmniFocus and surface the project as
 * overdue for review immediately — matches the app UX, no special handling.
 *
 * @see GH issue 467
 * @see src/adapter/jxa/JxaTransport.ts — caller
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/lookup_or_throw.js

  // byId() instead of a flattenedProjects() linear scan (#788/#1089).
  const target = lookupOrThrow(
    ofApp.defaultDocument.flattenedProjects.byId(args.id),
    "Project",
    args.id,
  );

  // @ts-expect-error JXA accepts property-setter form on sdef properties; see _types/sdef-overrides.d.ts.
  target.nextReviewDate = args.nextReviewDate === null ? null : new Date(args.nextReviewDate);

  return JSON.stringify({ id: args.id });
}
