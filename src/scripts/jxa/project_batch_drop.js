// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: batch-drop projects in a single round-trip.
 *
 * Args (argv[0] JSON): { items: Array<{ id: string }> }
 * Returns JSON: { succeeded: [{index, value}], failed: [{index, errorCode, message}] }
 *
 * Per-item failures do not abort the batch. Dropped projects remain in
 * OmniFocus but are treated as cancelled/inactive.
 *
 * NOTE: projects are located via a single O(n) scan over flattenedProjects()
 * (consistent with project_drop.js) then looked up in O(1) per item.
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/scripts/jxa/project_drop.js — singular counterpart
 * @see src/scripts/jxa/project_batch_complete.js — sibling pattern
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;
  const doc = ofApp.defaultDocument;

  // Build set of wanted IDs for early-exit.
  /** @type {Record<string, true>} */
  const wantedIds = {};
  for (let k = 0; k < args.items.length; k++) {
    wantedIds[args.items[k].id] = true;
  }

  // Single O(n) pass to build id → project map.
  const allProjects = doc.flattenedProjects();
  /** @type {Record<string, Project>} */
  const projectMap = {};
  for (let i = 0; i < allProjects.length; i++) {
    const p = allProjects[i];
    const pid = p.id();
    if (wantedIds[pid]) {
      projectMap[pid] = p;
    }
  }

  const succeeded = [];
  const failed = [];

  for (let i = 0; i < args.items.length; i++) {
    const it = args.items[i];
    try {
      const project = projectMap[it.id];
      if (!project) throw new Error(`OF_NOT_FOUND: project ${it.id}`);
      // @ts-expect-error JXA accepts property-setter form on sdef properties; see _types/sdef-overrides.d.ts.
      project.status = "dropped";
      succeeded.push({ index: i, value: it.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const m = msg.match(/^(OF_[A-Z_]+):/);
      const errorCode = m ? m[1] : "OF_UNKNOWN";
      failed.push({ index: i, errorCode: errorCode, message: msg });
    }
  }

  return JSON.stringify({ succeeded: succeeded, failed: failed });
}
