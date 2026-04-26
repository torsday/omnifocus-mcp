#!/usr/bin/env node
// Seed the integration-test fixtures into a live OmniFocus database.
//
// **Idempotent.** Every call removes any existing entities with the
// `mcp-fixture:` prefix before re-creating the canonical set, so it is
// safe to re-run across CI invocations and after partial / failed runs
// without accumulating stale state. `integration.yml` invokes it before
// every test run for this reason.
//
// Production OmniFocus data is untouched: only `mcp-fixture:`-prefixed
// objects are touched. Pass `--clean` to delete fixtures without
// re-creating them (used by interactive cleanup).
//
// Run locally with:
//   node scripts/seed-integration-db.js
// Then run the integration suite:
//   OMNIFOCUS_INTEGRATION=1 pnpm test:integration

const { spawnSync } = require("node:child_process");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURE_PREFIX = "mcp-fixture:";
const args = process.argv.slice(2);
const cleanFirst = args.includes("--clean");

/**
 * Run a JXA script string via `osascript -l JavaScript`.
 * Returns the parsed JSON output, or throws with the stderr text.
 */
function jxa(script) {
  const result = spawnSync("osascript", ["-l", "JavaScript", "-e", script], {
    encoding: "utf8",
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

const seedScript = `
(function() {
  "use strict";

  var of = Application("OmniFocus");
  var doc = of.defaultDocument;
  var PREFIX = ${JSON.stringify(FIXTURE_PREFIX)};
  var cleanFirst = ${JSON.stringify(cleanFirst)};
  var created = { tags: [], folders: [], projects: [], tasks: [] };
  var skipped = { tags: 0, folders: 0, projects: 0, tasks: 0 };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function findTag(name) {
    var matches = doc.flattenedTags.whose({ name: name });
    return matches.length > 0 ? matches[0] : null;
  }

  function findFolder(name) {
    var matches = doc.flattenedFolders.whose({ name: name });
    return matches.length > 0 ? matches[0] : null;
  }

  function findProject(name) {
    var matches = doc.flattenedProjects.whose({ name: name });
    return matches.length > 0 ? matches[0] : null;
  }

  function findInboxTask(name) {
    var matches = doc.inboxTasks.whose({ name: name });
    return matches.length > 0 ? matches[0] : null;
  }

  function findProjectTask(proj, name) {
    var matches = proj.flattenedTasks.whose({ name: name });
    return matches.length > 0 ? matches[0] : null;
  }

  // -------------------------------------------------------------------------
  // Optional clean pass — remove all mcp-fixture items
  // -------------------------------------------------------------------------

  if (cleanFirst) {
    // Remove projects first (deleting a folder orphans its projects in OF)
    var allProjects = doc.flattenedProjects();
    for (var i = allProjects.length - 1; i >= 0; i--) {
      if (allProjects[i].name().indexOf(PREFIX) === 0) {
        allProjects[i].delete();
      }
    }
    // Remove inbox tasks
    var inboxTasks = doc.inboxTasks();
    for (var i = inboxTasks.length - 1; i >= 0; i--) {
      if (inboxTasks[i].name().indexOf(PREFIX) === 0) {
        inboxTasks[i].delete();
      }
    }
    // Remove folders
    var allFolders = doc.flattenedFolders();
    for (var i = allFolders.length - 1; i >= 0; i--) {
      if (allFolders[i].name().indexOf(PREFIX) === 0) {
        allFolders[i].delete();
      }
    }
    // Remove tags
    var allTags = doc.flattenedTags();
    for (var i = allTags.length - 1; i >= 0; i--) {
      if (allTags[i].name().indexOf(PREFIX) === 0) {
        allTags[i].delete();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tags (5)
  // -------------------------------------------------------------------------

  var tagNames = ["urgent", "waiting", "someday", "work", "personal"];
  var tags = {};
  for (var i = 0; i < tagNames.length; i++) {
    var fullName = PREFIX + tagNames[i];
    var existing = findTag(fullName);
    if (existing) {
      tags[tagNames[i]] = existing;
      skipped.tags++;
    } else {
      var t = of.Tag({ name: fullName });
      doc.tags.push(t);
      tags[tagNames[i]] = findTag(fullName);
      created.tags.push(fullName);
    }
  }

  // -------------------------------------------------------------------------
  // Folders (2)
  // -------------------------------------------------------------------------

  var workFolderName = PREFIX + "Work";
  var personalFolderName = PREFIX + "Personal";

  var workFolder = findFolder(workFolderName);
  if (workFolder) {
    skipped.folders++;
  } else {
    var wf = of.Folder({ name: workFolderName });
    doc.folders.push(wf);
    workFolder = findFolder(workFolderName);
    created.folders.push(workFolderName);
  }

  var personalFolder = findFolder(personalFolderName);
  if (personalFolder) {
    skipped.folders++;
  } else {
    var pf = of.Folder({ name: personalFolderName });
    doc.folders.push(pf);
    personalFolder = findFolder(personalFolderName);
    created.folders.push(personalFolderName);
  }

  // -------------------------------------------------------------------------
  // Projects (3)
  // -------------------------------------------------------------------------

  // Active project in Work folder
  var activeProjectName = PREFIX + "Work > Active Project";
  var activeProject = findProject(activeProjectName);
  if (activeProject) {
    skipped.projects++;
  } else {
    var ap = of.Project({ name: activeProjectName, status: "active status" });
    workFolder.projects.push(ap);
    activeProject = findProject(activeProjectName);
    created.projects.push(activeProjectName);
  }

  // On-hold project in Work folder
  var onHoldProjectName = PREFIX + "Work > On-Hold Project";
  var onHoldProject = findProject(onHoldProjectName);
  if (onHoldProject) {
    skipped.projects++;
  } else {
    var ohp = of.Project({ name: onHoldProjectName, status: "on hold status" });
    workFolder.projects.push(ohp);
    onHoldProject = findProject(onHoldProjectName);
    created.projects.push(onHoldProjectName);
  }

  // Active project in Personal folder
  var alphaProjectName = PREFIX + "Personal > Project Alpha";
  var alphaProject = findProject(alphaProjectName);
  if (alphaProject) {
    skipped.projects++;
  } else {
    var alphap = of.Project({ name: alphaProjectName, status: "active status" });
    personalFolder.projects.push(alphap);
    alphaProject = findProject(alphaProjectName);
    created.projects.push(alphaProjectName);
  }

  // -------------------------------------------------------------------------
  // Inbox tasks (2)
  // -------------------------------------------------------------------------

  var inbox1Name = PREFIX + "Inbox Task 1";
  if (findInboxTask(inbox1Name)) {
    skipped.tasks++;
  } else {
    var it1 = of.InboxTask({ name: inbox1Name, flagged: true });
    doc.inboxTasks.push(it1);
    created.tasks.push(inbox1Name);
  }

  var inbox2Name = PREFIX + "Inbox Task 2";
  if (findInboxTask(inbox2Name)) {
    skipped.tasks++;
  } else {
    var it2 = of.InboxTask({ name: inbox2Name });
    doc.inboxTasks.push(it2);
    created.tasks.push(inbox2Name);
  }

  // -------------------------------------------------------------------------
  // Tasks in active project (5)
  // -------------------------------------------------------------------------

  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(17, 0, 0, 0);

  var deferred = new Date();
  deferred.setDate(deferred.getDate() + 7);
  deferred.setHours(9, 0, 0, 0);

  // Flagged + tagged + due tomorrow
  var activeTask1Name = PREFIX + "Active Task 1";
  if (findProjectTask(activeProject, activeTask1Name)) {
    skipped.tasks++;
  } else {
    var at1 = of.Task({
      name: activeTask1Name,
      flagged: true,
      dueDate: tomorrow,
    });
    activeProject.tasks.push(at1);
    if (tags["urgent"]) {
      of.add(tags["urgent"], { to: findProjectTask(activeProject, activeTask1Name).tags });
    }
    created.tasks.push(activeTask1Name);
  }

  // Tagged waiting
  var activeTask2Name = PREFIX + "Active Task 2";
  if (findProjectTask(activeProject, activeTask2Name)) {
    skipped.tasks++;
  } else {
    var at2 = of.Task({ name: activeTask2Name });
    activeProject.tasks.push(at2);
    if (tags["waiting"]) {
      of.add(tags["waiting"], { to: findProjectTask(activeProject, activeTask2Name).tags });
    }
    created.tasks.push(activeTask2Name);
  }

  // Completed
  var completedTaskName = PREFIX + "Completed Task";
  if (findProjectTask(activeProject, completedTaskName)) {
    skipped.tasks++;
  } else {
    var ct = of.Task({ name: completedTaskName });
    activeProject.tasks.push(ct);
    var ctRef = findProjectTask(activeProject, completedTaskName);
    if (ctRef) { ctRef.markComplete(); }
    created.tasks.push(completedTaskName);
  }

  // Deferred
  var deferredTaskName = PREFIX + "Deferred Task";
  if (findProjectTask(activeProject, deferredTaskName)) {
    skipped.tasks++;
  } else {
    var dt = of.Task({ name: deferredTaskName, deferDate: deferred });
    activeProject.tasks.push(dt);
    created.tasks.push(deferredTaskName);
  }

  // Has a note
  var noteTaskName = PREFIX + "Note Task";
  if (findProjectTask(alphaProject, noteTaskName)) {
    skipped.tasks++;
  } else {
    var nt = of.Task({
      name: noteTaskName,
      note: "This is a fixture note.\\nIt has multiple lines.\\nUsed to verify note round-trip.",
    });
    alphaProject.tasks.push(nt);
    created.tasks.push(noteTaskName);
  }

  return JSON.stringify({ created: created, skipped: skipped });
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
