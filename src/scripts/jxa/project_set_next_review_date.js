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
 *   - `nextReviewDate` null     → clear (Project shows up as not scheduled)
 *
 * Returns JSON: { id: string }
 *
 * Past-dated values are allowed by OmniFocus and surface the project as
 * overdue for review immediately — matches the app UX, no special handling.
 *
 * @see #467
 * @see src/adapter/jxa/JxaTransport.ts — caller
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  const allProjects = ofApp.defaultDocument.flattenedProjects();
  let target = null;
  for (let i = 0; i < allProjects.length; i++) {
    if (allProjects[i].id() === args.id) {
      target = allProjects[i];
      break;
    }
  }
  if (!target) throw new Error(`Project not found: ${args.id}`);

  target.nextReviewDate = args.nextReviewDate === null ? null : new Date(args.nextReviewDate);

  return JSON.stringify({ id: args.id });
}
