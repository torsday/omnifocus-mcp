#!/usr/bin/env node
// Seed the integration-test fixtures into a live OmniFocus database.
//
// Modes:
//   default      — skip-if-exists. Creates only the canonical fixtures that
//                  aren't already present. Does NOT remove orphan
//                  `mcp-fixture:` items from prior runs.
//   `--clean`    — remove ALL `mcp-fixture:`-prefixed items (tags, folders,
//                  projects, tasks) before re-creating the canonical set.
//                  Use this when prior cancelled / partial runs may have left
//                  orphans that would collide with current-run expectations.
//                  `integration.yml` passes `--clean` so CI starts from a
//                  known state every run (#929).
//
// Production OmniFocus data is untouched in both modes: only
// `mcp-fixture:`-prefixed objects are touched.
//
// Run locally with:
//   node scripts/seed-integration-db.js          # additive seed
//   node scripts/seed-integration-db.js --clean  # wipe and re-seed
// Then run the integration suite:
//   OMNIFOCUS_INTEGRATION=1 pnpm test:integration

import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURE_PREFIX = "mcp-fixture:";
// The contract harness's sandbox mode (tests/contract/adapter.contract.ts)
// names its per-run folder `${prefix}-${runId}` where prefix defaults to
// "mcp-fixture" — i.e. `mcp-fixture-<runId>` with a hyphen, not a colon.
// `--clean` must wipe both shapes so harness residue doesn't accumulate
// unbounded across runs (45 stale folders observed on the runner before
// #960's cleanup). Both shapes share the literal `mcp-fixture` prefix.
const FIXTURE_PREFIX_BASE = "mcp-fixture";
const args = process.argv.slice(2);
const cleanFirst = args.includes("--clean");

/**
 * Run a JXA script string via `osascript -l JavaScript`.
 * Returns the parsed JSON output, or throws with the stderr text.
 */
function jxa(script) {
  const result = spawnSync("osascript", ["-l", "JavaScript", "-e", script], {
    encoding: "utf8",
    // 30s. Both the clean and create phases now run inside OmniFocus via
    // OmniJS (#960 + #962): one Apple Event round-trip total, regardless
    // of how many fixtures are involved. Measured locally at single-
    // digit seconds against a 600+ task runner. 30s gives generous
    // headroom for sync hiccups without inviting hangs.
    timeout: 30_000,
  });

  if (result.error) {
    throw new Error(`osascript spawn failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const msg = (result.stderr || "").trim();
    throw new Error(`osascript exited ${result.status}: ${msg}`);
  }

  const raw = (result.stdout || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    // Some JXA calls return empty or non-JSON (e.g. void returns)
    return raw || null;
  }
}

/**
 * Check whether OmniFocus is running.  Uses System Events so we avoid
 * triggering an Automation permission prompt for OmniFocus itself just for
 * the liveness check.
 */
function isOmniFocusRunning() {
  try {
    const running = jxa(`
      const se = Application("System Events");
      JSON.stringify(se.processes.whose({ name: "OmniFocus" }).length > 0);
    `);
    return running === true || running === "true";
  } catch {
    return false;
  }
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function die(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

log("omnifocus-mcp integration seed script");
log("--------------------------------------");

if (!isOmniFocusRunning()) {
  die(
    "OmniFocus is not running.\n" +
      "Please launch OmniFocus and grant Automation permission when prompted,\n" +
      "then re-run this script.",
  );
}

log("✓ OmniFocus is running");

// ---------------------------------------------------------------------------
// JXA seed payload
//
// Everything runs in a single osascript invocation to minimise round-trips.
// The script is self-contained: it receives `cleanFirst` and `prefix` as
// injected constants and returns a JSON summary of what was created/skipped.
// ---------------------------------------------------------------------------

// The seed runs entirely inside OmniFocus via `evaluateJavascript` (Omni
// Automation / OmniJS). JXA's per-item `push` + `whose({name: X})` round-
// trips cost ~2–5s each through Apple Events; on a populated runner the
// 17 fixture creates accumulated to 60–120s of wall time and the seed
// had to carry a 180s spawn timeout. OmniJS runs in-process: one bridge
// call, single-digit seconds total. The outer JXA wrapper exists only
// to drive `evaluateJavascript`. See #962 (this change) and #960 (the
// clean-pass migration that established this pattern).
const seedOmniJs = `
(() => {
  "use strict";

  const PREFIX = ${JSON.stringify(FIXTURE_PREFIX)};
  const PREFIX_BASE = ${JSON.stringify(FIXTURE_PREFIX_BASE)};
  const cleanFirst = ${JSON.stringify(cleanFirst)};
  const created = { tags: [], folders: [], projects: [], tasks: [] };
  const skipped = { tags: 0, folders: 0, projects: 0, tasks: 0 };

  // Skip zombies: OmniJS's global collections (\`flattenedFolders\`,
  // \`flattenedTags\`, etc.) can return stale references for objects that
  // were just deleted in the same script. Touching .name on such a
  // reference throws "X is no longer valid". Treat any throw as
  // "not the one we're looking for" and continue scanning.
  const findIn = (coll, name) => {
    for (let i = 0; i < coll.length; i++) {
      let n;
      try { n = coll[i].name; } catch (_) { continue; }
      if (n === name) return coll[i];
    }
    return null;
  };

  // Clean pass — wipe both seed-owned ("mcp-fixture:") and harness-owned
  // ("mcp-fixture-<runId>") items by matching the shared base prefix.
  // Projects before folders so OF doesn't orphan project contents.
  if (cleanFirst) {
    flattenedProjects.slice().forEach(p => { if (p.name && p.name.startsWith(PREFIX_BASE)) deleteObject(p); });
    inbox.slice().forEach(t => { if (t.name && t.name.startsWith(PREFIX_BASE)) deleteObject(t); });
    flattenedFolders.slice().forEach(f => { if (f.name && f.name.startsWith(PREFIX_BASE)) deleteObject(f); });
    flattenedTags.slice().forEach(t => { if (t.name && t.name.startsWith(PREFIX_BASE)) deleteObject(t); });
  }

  // Tags (5)
  const tagShortNames = ["urgent", "waiting", "someday", "work", "personal"];
  const tags = {};
  for (const short of tagShortNames) {
    const fullName = PREFIX + short;
    const existing = findIn(flattenedTags, fullName);
    if (existing) {
      tags[short] = existing;
      skipped.tags++;
    } else {
      tags[short] = new Tag(fullName);
      created.tags.push(fullName);
    }
  }

  // Folders (2)
  const workFolderName = PREFIX + "Work";
  const personalFolderName = PREFIX + "Personal";
  let workFolder = findIn(flattenedFolders, workFolderName);
  if (workFolder) { skipped.folders++; } else { workFolder = new Folder(workFolderName); created.folders.push(workFolderName); }
  let personalFolder = findIn(flattenedFolders, personalFolderName);
  if (personalFolder) { skipped.folders++; } else { personalFolder = new Folder(personalFolderName); created.folders.push(personalFolderName); }

  // Projects (3) — passed-in folder positions the new project inside it
  const activeProjectName = PREFIX + "Work > Active Project";
  let activeProject = findIn(flattenedProjects, activeProjectName);
  if (activeProject) { skipped.projects++; } else {
    activeProject = new Project(activeProjectName, workFolder);
    activeProject.status = Project.Status.Active;
    created.projects.push(activeProjectName);
  }

  const onHoldProjectName = PREFIX + "Work > On-Hold Project";
  let onHoldProject = findIn(flattenedProjects, onHoldProjectName);
  if (onHoldProject) { skipped.projects++; } else {
    onHoldProject = new Project(onHoldProjectName, workFolder);
    onHoldProject.status = Project.Status.OnHold;
    created.projects.push(onHoldProjectName);
  }

  const alphaProjectName = PREFIX + "Personal > Project Alpha";
  let alphaProject = findIn(flattenedProjects, alphaProjectName);
  if (alphaProject) { skipped.projects++; } else {
    alphaProject = new Project(alphaProjectName, personalFolder);
    alphaProject.status = Project.Status.Active;
    created.projects.push(alphaProjectName);
  }

  // Inbox tasks (2) — \`new Task(name)\` with no parent goes to inbox
  const inbox1Name = PREFIX + "Inbox Task 1";
  if (findIn(inbox, inbox1Name)) { skipped.tasks++; } else {
    const t = new Task(inbox1Name);
    t.flagged = true;
    created.tasks.push(inbox1Name);
  }
  const inbox2Name = PREFIX + "Inbox Task 2";
  if (findIn(inbox, inbox2Name)) { skipped.tasks++; } else {
    new Task(inbox2Name);
    created.tasks.push(inbox2Name);
  }

  // Tasks in active project (5)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(17, 0, 0, 0);
  const deferredAt = new Date();
  deferredAt.setDate(deferredAt.getDate() + 7);
  deferredAt.setHours(9, 0, 0, 0);

  const findInProject = (proj, name) => findIn(proj.flattenedTasks, name);

  // Flagged + tagged + due tomorrow
  const activeTask1Name = PREFIX + "Active Task 1";
  if (findInProject(activeProject, activeTask1Name)) { skipped.tasks++; } else {
    const at1 = new Task(activeTask1Name, activeProject);
    at1.flagged = true;
    at1.dueDate = tomorrow;
    if (tags.urgent) at1.addTag(tags.urgent);
    created.tasks.push(activeTask1Name);
  }

  // Tagged waiting
  const activeTask2Name = PREFIX + "Active Task 2";
  if (findInProject(activeProject, activeTask2Name)) { skipped.tasks++; } else {
    const at2 = new Task(activeTask2Name, activeProject);
    if (tags.waiting) at2.addTag(tags.waiting);
    created.tasks.push(activeTask2Name);
  }

  // Completed
  const completedTaskName = PREFIX + "Completed Task";
  if (findInProject(activeProject, completedTaskName)) { skipped.tasks++; } else {
    const ct = new Task(completedTaskName, activeProject);
    ct.markComplete();
    created.tasks.push(completedTaskName);
  }

  // Deferred
  const deferredTaskName = PREFIX + "Deferred Task";
  if (findInProject(activeProject, deferredTaskName)) { skipped.tasks++; } else {
    const dt = new Task(deferredTaskName, activeProject);
    dt.deferDate = deferredAt;
    created.tasks.push(deferredTaskName);
  }

  // Has a note (in Personal > Project Alpha)
  const noteTaskName = PREFIX + "Note Task";
  if (findInProject(alphaProject, noteTaskName)) { skipped.tasks++; } else {
    const nt = new Task(noteTaskName, alphaProject);
    nt.note = "This is a fixture note.\\nIt has multiple lines.\\nUsed to verify note round-trip.";
    created.tasks.push(noteTaskName);
  }

  return JSON.stringify({ created, skipped });
})()
`;

// JXA wrapper — \`evaluateJavascript\` returns the OmniJS expression's value
// as a string. The OmniJS payload returns a JSON-encoded summary; pass it
// straight through.
const seedScript = `
(function() {
  "use strict";
  var of = Application("OmniFocus");
  return of.evaluateJavascript(${JSON.stringify(seedOmniJs)});
})();
`;

// ---------------------------------------------------------------------------
// Run the seed
// ---------------------------------------------------------------------------

log(`Mode: ${cleanFirst ? "clean + re-seed" : "idempotent (skip existing)"}`);
log("Seeding OmniFocus…\n");

let result;
try {
  result = jxa(seedScript);
} catch (err) {
  const msg = err.message || String(err);
  if (
    msg.includes("Application can't be found") ||
    msg.includes("OmniFocus") ||
    msg.includes("-1728")
  ) {
    die(
      `Could not communicate with OmniFocus.\nMake sure OmniFocus is running and Automation permission is granted.\nSystem Settings → Privacy & Security → Automation → Terminal → OmniFocus ✓\n\nDetail: ${msg}`,
    );
  }
  die(`Seed script failed: ${msg}`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (!result || typeof result !== "object") {
  die(`Unexpected output from seed script: ${JSON.stringify(result)}`);
}

const { created, skipped } = result;

log("Tags");
for (const name of created.tags) log(`  + ${name}`);
if (skipped.tags > 0) log(`  (${skipped.tags} already existed, skipped)`);

log("\nFolders");
for (const name of created.folders) log(`  + ${name}`);
if (skipped.folders > 0) log(`  (${skipped.folders} already existed, skipped)`);

log("\nProjects");
for (const name of created.projects) log(`  + ${name}`);
if (skipped.projects > 0) log(`  (${skipped.projects} already existed, skipped)`);

log("\nTasks");
for (const name of created.tasks) log(`  + ${name}`);
if (skipped.tasks > 0) log(`  (${skipped.tasks} already existed, skipped)`);

const totalCreated =
  created.tags.length + created.folders.length + created.projects.length + created.tasks.length;
const totalSkipped = skipped.tags + skipped.folders + skipped.projects + skipped.tasks;

log(`\n✓ Done — ${totalCreated} items created, ${totalSkipped} already present.`);
log("\nYou can now run: OMNIFOCUS_INTEGRATION=1 pnpm test:integration");
