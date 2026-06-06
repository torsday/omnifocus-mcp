#!/usr/bin/env node
// =============================================================================
// clean-integration-db.js — delete every `mcp-fixture`-prefixed object from the
// live OmniFocus database, without re-seeding.
// =============================================================================
// The integration tier (`tests/contract/adapter.contract.ts` sandbox mode,
// `seed-integration-db.js`) names every object it creates with the
// `mcp-fixture` base prefix so the live database can be swept clean. The
// sandbox harness bulk-deletes its own `mcp-fixture-<runId>` folder in
// `afterAll` — but if the suite is killed mid-run (timeout, CI cancel, a
// crash) that teardown never fires and the fixture tree survives. See #1101.
//
// This script is the safety net: it deletes ALL `mcp-fixture*` items
// regardless of which run created them, so it's safe to run as a pre/post
// bookend around the integration suite (`pnpm of:clean`) and as an
// `if: always()` CI teardown step. It does NOT seed — that's
// `seed-integration-db.js`'s job.
//
// SAFETY: only objects whose name starts with `mcp-fixture` are touched.
// Your real projects/folders/tags/tasks are never matched. The match is the
// same `startsWith(PREFIX_BASE)` rule `seed-integration-db.js --clean` uses.
//
// Usage:
//   node scripts/clean-integration-db.js          # delete all mcp-fixture* items
//   node scripts/clean-integration-db.js --dry-run # report what would be deleted, delete nothing
//
// Exit codes:
//   0  — clean succeeded (or dry-run completed)
//   1  — OmniFocus not running / not reachable, or the script errored
// =============================================================================

import { spawnSync } from "node:child_process";

const FIXTURE_PREFIX_BASE = "mcp-fixture";
const dryRun = process.argv.includes("--dry-run");

/** Run a JXA script string via `osascript -l JavaScript`. */
function jxa(script) {
  const result = spawnSync("osascript", ["-l", "JavaScript", "-e", script], {
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`osascript spawn failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const msg = (result.stderr || "").trim() || `exit ${result.status}`;
    throw new Error(`osascript exited ${result.status}: ${msg}`);
  }
  const out = (result.stdout || "").trim();
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`Unexpected output: ${out}`);
  }
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function die(msg) {
  process.stderr.write(`clean-integration-db: ${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// OmniJS clean payload — single in-process bridge call (no per-item Apple
// Events). Matches the proven clean pass in seed-integration-db.js (#960,
// #962, #975): projects before folders so contents aren't orphaned; swallow
// zombie references whose parent delete already cascaded them.
// ---------------------------------------------------------------------------
const cleanOmniJs = `
(() => {
  "use strict";
  const PREFIX_BASE = ${JSON.stringify(FIXTURE_PREFIX_BASE)};
  const dryRun = ${JSON.stringify(dryRun)};
  const deleted = { projects: 0, inboxTasks: 0, folders: 0, tags: 0 };
  const names = [];

  const sweep = (coll, kind) => {
    coll.slice().forEach((obj) => {
      let n;
      try { n = obj.name; } catch (_) { return; } // zombie ref — already gone
      if (!n || !n.startsWith(PREFIX_BASE)) return;
      if (dryRun) {
        deleted[kind]++;
        if (names.length < 200) names.push(kind + ": " + n);
        return;
      }
      try { deleteObject(obj); deleted[kind]++; }
      catch (_) { /* cascaded by a parent delete — already gone */ }
    });
  };

  // Order matters: projects + inbox tasks first, then folders (cascade),
  // then tags. Matches seed-integration-db.js --clean ordering.
  sweep(flattenedProjects, "projects");
  sweep(inbox, "inboxTasks");
  sweep(flattenedFolders, "folders");
  sweep(flattenedTags, "tags");

  return JSON.stringify({ deleted, names, dryRun });
})()
`;

const cleanScript = `
(function() {
  "use strict";
  var of = Application("OmniFocus");
  return of.evaluateJavascript(${JSON.stringify(cleanOmniJs)});
})();
`;

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

log("omnifocus-mcp integration cleanup");
log("---------------------------------");
log(`Mode: ${dryRun ? "dry-run (report only)" : "delete all mcp-fixture* items"}`);

let result;
try {
  result = jxa(cleanScript);
} catch (err) {
  const msg = err.message || String(err);
  if (
    msg.includes("Application can't be found") ||
    msg.includes("OmniFocus") ||
    msg.includes("-1728")
  ) {
    die(
      `Could not communicate with OmniFocus.\nMake sure OmniFocus is running and Automation permission is granted.\n\nDetail: ${msg}`,
    );
  }
  die(`Clean script failed: ${msg}`);
}

if (!result || typeof result !== "object") {
  die(`Unexpected output: ${JSON.stringify(result)}`);
}

const { deleted, names } = result;
const total = deleted.projects + deleted.inboxTasks + deleted.folders + deleted.tags;

if (dryRun && names.length > 0) {
  log("\nWould delete:");
  for (const n of names) log(`  - ${n}`);
}

log("");
log(
  `${dryRun ? "Would delete" : "Deleted"}: ${deleted.projects} projects, ${deleted.inboxTasks} inbox tasks, ${deleted.folders} folders, ${deleted.tags} tags (${total} total)`,
);
log(dryRun ? "Dry-run complete — nothing was deleted." : "Cleanup complete.");
