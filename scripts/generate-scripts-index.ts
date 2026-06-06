#!/usr/bin/env tsx
/**
 * Generates scripts/README.md — one entry per script, grouped by purpose.
 *
 * Usage:
 *   pnpm run docs:generate-scripts    # write the file
 *   pnpm run docs:check-scripts       # exit non-zero if stale
 *
 * Each script's first comment block is parsed for:
 *   - A one-line description (first non-shebang comment line containing " — ")
 *   - A usage example (line(s) after "Usage:" or containing "bash scripts/")
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = __dirname;
const OUT_PATH = path.join(SCRIPTS_DIR, "README.md");
const CHECK_MODE = process.argv.includes("--check");

// ---------------------------------------------------------------------------
// Script registry — explicit metadata for each script. This avoids fragile
// header parsing and ensures the index is always accurate even when a script
// doesn't follow the header convention.
// ---------------------------------------------------------------------------

interface ScriptEntry {
  file: string;
  description: string;
  usage: string;
  group: string;
}

const SCRIPTS: ScriptEntry[] = [
  // ── Build ──────────────────────────────────────────────────────────────
  {
    file: "build-calendar-bridge.sh",
    description: "Compile the Swift EventKit calendar-bridge binary (per ADR-0018).",
    usage: "bash scripts/build-calendar-bridge.sh",
    group: "build",
  },
  {
    file: "build-watcher.sh",
    description: "Compile the Swift FSEventStream watcher binary (universal fat binary).",
    usage: "bash scripts/build-watcher.sh",
    group: "build",
  },
  // ── Verify / lint ──────────────────────────────────────────────────────
  {
    file: "check-automation-permission.sh",
    description: "Verify the shell process has macOS Automation permission for OmniFocus.",
    usage: "bash scripts/check-automation-permission.sh",
    group: "verify",
  },
  {
    file: "check-bundle-size.sh",
    description: "Enforce the dist/index.js bundle-size budget (< 820 KiB per DESIGN §20).",
    usage: "bash scripts/check-bundle-size.sh",
    group: "verify",
  },
  {
    file: "verify-constants.sh",
    description: "Catch drift between _project-constants.sh and the live GitHub Project field IDs.",
    usage: "bash scripts/verify-constants.sh",
    group: "verify",
  },
  {
    file: "verify-intents.sh",
    description: "Verify omnifocus://intents references only registered tools/prompts/resources.",
    usage: "bash scripts/verify-intents.sh",
    group: "verify",
  },
  {
    file: "verify-no-hosted-runners.sh",
    description: "Fail if any workflow targets a GitHub-hosted runner outside the allowlist.",
    usage: "bash scripts/verify-no-hosted-runners.sh",
    group: "verify",
  },
  {
    file: "verify-no-tool-counts.sh",
    description: "Fail if any living doc restates the count of registered MCP tools (per #478).",
    usage: "bash scripts/verify-no-tool-counts.sh",
    group: "verify",
  },
  {
    file: "lint-custom.ts",
    description: "Custom lint runner — calls src/linting/customRules.ts over all source files.",
    usage: "pnpm run lint:custom  # or: tsx scripts/lint-custom.ts",
    group: "verify",
  },
  {
    file: "verify-nl-quality.ts",
    description: "Enforce the NL-quality rubric over src/tools/ descriptions at lint time.",
    usage: "tsx scripts/verify-nl-quality.ts",
    group: "verify",
  },
  {
    file: "validate-deps.sh",
    description: "Audit the 'Blocked by: #N' dependency graph for cycles and orphan references.",
    usage: "bash scripts/validate-deps.sh",
    group: "verify",
  },
  // ── Generate / docs ────────────────────────────────────────────────────
  {
    file: "generate-tool-docs.ts",
    description: "Generate docs/tools.md — full parameter reference for every MCP tool.",
    usage: "pnpm run docs:generate  # or: tsx scripts/generate-tool-docs.ts",
    group: "generate",
  },
  {
    file: "extract-changelog-section.sh",
    description: "Print a single CHANGELOG.md section body for use in GitHub Release notes.",
    usage: "bash scripts/extract-changelog-section.sh 1.2.3",
    group: "generate",
  },
  // ── Project / tracker ──────────────────────────────────────────────────
  {
    file: "file-issue.sh",
    description: "Atomically create a GitHub issue and wire it into project #4 with all fields.",
    usage: "bash scripts/file-issue.sh --title '...' --labels '...' --status 'Up Next'",
    group: "tracker",
  },
  {
    file: "set-ready-status.sh",
    description: "Set Status=Up Next on unblocked issues and Backlog on blocked ones.",
    usage: "bash scripts/set-ready-status.sh",
    group: "tracker",
  },
  {
    file: "populate-project.sh",
    description: "Add all issues to the v1 project board and set Phase/Priority/Size/Risk fields.",
    usage: "bash scripts/populate-project.sh",
    group: "tracker",
  },
  // ── Release ────────────────────────────────────────────────────────────
  {
    file: "update-homebrew-formula.sh",
    description: "Update the omnifocus-mcp Homebrew formula in torsday/homebrew-tap after publish.",
    usage: "bash scripts/update-homebrew-formula.sh <version>",
    group: "release",
  },
  // ── Integration / seeding ──────────────────────────────────────────────
  {
    file: "seed-integration-db.js",
    description: "Seed mcp-fixture: prefixed items into a live OmniFocus for integration tests.",
    usage: "node scripts/seed-integration-db.js [--clean]",
    group: "integration",
  },
  {
    file: "clean-integration-db.js",
    description:
      "Delete every mcp-fixture* item from a live OmniFocus (no re-seed). Safety net for killed suites that skip afterAll teardown; runs as test:integration's posttest hook and the CI if:always() cleanup step.",
    usage: "node scripts/clean-integration-db.js [--dry-run]",
    group: "integration",
  },
];

// Group display order and labels
const GROUP_META: Record<string, { label: string; order: number }> = {
  build: { label: "Build", order: 1 },
  verify: { label: "Verify / lint", order: 2 },
  generate: { label: "Generate / docs", order: 3 },
  tracker: { label: "Project / tracker", order: 4 },
  release: { label: "Release", order: 5 },
  integration: { label: "Integration / seeding", order: 6 },
};

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const grouped = new Map<string, ScriptEntry[]>();
for (const entry of SCRIPTS) {
  if (!grouped.has(entry.group)) grouped.set(entry.group, []);
  grouped.get(entry.group)?.push(entry);
}

const orderedGroups = [...grouped.keys()].sort(
  (a, b) => (GROUP_META[a]?.order ?? 99) - (GROUP_META[b]?.order ?? 99),
);

const lines: string[] = [
  "<!-- generated by scripts/generate-scripts-index.ts — do not edit manually -->",
  "# scripts/",
  "",
  "Helper scripts for building, linting, seeding, and releasing omnifocus-mcp.",
  "Read this file before grepping scripts/ — the right script is often one line away.",
  "",
];

for (const group of orderedGroups) {
  const meta = GROUP_META[group] ?? { label: group };
  lines.push(`## ${meta.label}`);
  lines.push("");
  for (const { file, description, usage } of grouped.get(group) ?? []) {
    lines.push(`### ${file}`);
    lines.push("");
    lines.push(description);
    lines.push("");
    lines.push("```bash");
    lines.push(usage);
    lines.push("```");
    lines.push("");
  }
}

const content = lines.join("\n");

// ---------------------------------------------------------------------------
// Write or check
// ---------------------------------------------------------------------------

if (CHECK_MODE) {
  const existing = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, "utf8") : "";
  if (existing !== content) {
    console.error("scripts/README.md is out of date. Run: pnpm run docs:generate-scripts");
    process.exit(1);
  }
  console.log("scripts/README.md is up to date.");
} else {
  fs.writeFileSync(OUT_PATH, content, "utf8");
  const bytes = Buffer.byteLength(content, "utf8");
  console.log(`Generated ${OUT_PATH} (${SCRIPTS.length} scripts, ${bytes} bytes)`);
}
