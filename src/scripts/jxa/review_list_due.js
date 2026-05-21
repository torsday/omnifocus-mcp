// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: list projects due for review (nextReviewDate <= today, or null).
 *
 * Args (argv[0] JSON): {}
 * Returns JSON: { projects: Array<{ id, name, nextReviewDate, reviewIntervalDays, lastReviewDate }> }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/project.ts — Project domain type
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  JSON.parse(argv[0]); // validate JSON even though no args needed
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  const today = new Date();
  const allProjects = ofApp.defaultDocument.flattenedProjects();
  const due = [];

  for (let i = 0; i < allProjects.length; i++) {
    const p = allProjects[i];
    let nextReviewDate = null;
    try {
      const nd = p.nextReviewDate();
      nextReviewDate = nd ? nd.toISOString() : null;
    } catch (_e) {
      nextReviewDate = null;
    }

    const isDue = nextReviewDate === null || new Date(nextReviewDate) <= today;
    if (!isDue) continue;

    let lastReviewDate = null;
    try {
      const ld = p.lastReviewDate();
      lastReviewDate = ld ? ld.toISOString() : null;
    } catch (_e) {
      lastReviewDate = null;
    }

    let reviewIntervalDays = null;
    try {
      reviewIntervalDays = p.reviewIntervalDays();
    } catch (_e) {
      reviewIntervalDays = null;
    }

    due.push({
      id: p.id(),
      name: p.name(),
      nextReviewDate,
      reviewIntervalDays,
      lastReviewDate,
    });
  }

  // Sort: nulls first, then ascending by date string
  due.sort((a, b) => {
    if (a.nextReviewDate === null && b.nextReviewDate === null) return 0;
    if (a.nextReviewDate === null) return -1;
    if (b.nextReviewDate === null) return 1;
    return a.nextReviewDate.localeCompare(b.nextReviewDate);
  });

  return JSON.stringify({ projects: due });
}
