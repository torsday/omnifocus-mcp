#!/usr/bin/env tsx
/**
 * lint-doc-sizes.ts — enforce line-count budgets on agent-facing docs.
 *
 * Without a guardrail, docs drift back toward bloat one paragraph at a time.
 * This script preserves the agent-orientation gains from #804/#805/#809/#810.
 *
 * Usage:
 *   tsx scripts/lint-doc-sizes.ts           # exit non-zero if any budget exceeded
 *   tsx scripts/lint-doc-sizes.ts --summary # print all files and their line counts
 *
 * Escape hatch:
 *   Add a `<!-- doc-size-lint-disable: reason here -->` comment anywhere in the
 *   file to suppress the budget for that file. The file is still listed as a
 *   warning so growth is visible in PR review.
 *
 * Adding a budget:
 *   Add an entry to the BUDGETS array below. The `glob` is matched against
 *   the file's repo-relative path (forward slashes). `budget` is the max
 *   number of lines (inclusive).
 *
 * @see #830 — original issue and budget rationale
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SUMMARY_MODE = process.argv.includes("--summary");

// ---------------------------------------------------------------------------
// Budget registry — one entry per pattern.
// ---------------------------------------------------------------------------

interface BudgetEntry {
  /** Glob-like pattern matched against repo-relative path (forward slashes). */
  glob: string;
  /** Maximum allowed line count (inclusive). */
  budget: number;
  /** Human-readable rationale shown in actionable error messages. */
  rationale: string;
}

const BUDGETS: BudgetEntry[] = [
  // AGENTS.md: the primary agent entry point. Keep it dense and navigable.
  {
    glob: "AGENTS.md",
    budget: 200,
    rationale: "Split overflow into docs/ reference files or src/**CLAUDE.md subtrees",
  },
  // Per-directory CLAUDE.md files: narrow, local invariants only.
  {
    glob: "src/**/CLAUDE.md",
    budget: 80,
    rationale: "Extract detail to per-file comments or a shared docs/ reference doc",
  },
  // Post-#805: DESIGN.md becomes a thin index (< 100 lines). Not enforced
  // until #805 lands; tracked here for the future merge.
  // {
  //   glob: "DESIGN.md",
  //   budget: 100,
  //   rationale: "DESIGN.md is a thin index; move content to docs/design/<area>.md",
  // },
  // Post-#805: per-area design docs.
  // {
  //   glob: "docs/design/*.md",
  //   budget: 300,
  //   rationale: "Split into smaller docs/ files or pull shared content to DESIGN.md index",
  // },
  // agent-recipes.md (#810) — if it exists.
  {
    glob: "docs/agent-recipes.md",
    budget: 200,
    rationale: "Split into category-level recipe files",
  },
];

// ---------------------------------------------------------------------------
// Glob matching (no external deps — simple glob patterns only)
// ---------------------------------------------------------------------------

function matchGlob(pattern: string, filePath: string): boolean {
  // Convert glob to regex:
  //   **  → matches any path segment (including slashes)
  //   *   → matches any non-slash sequence
  //   .   → literal dot
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "§DOUBLE§")
    .replace(/\*/g, "[^/]*")
    .replace(/§DOUBLE§/g, ".*");
  return new RegExp(`^${regexStr}$`).test(filePath);
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function collectFiles(dir: string, repoRoot: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectFiles(full, repoRoot));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(path.relative(repoRoot, full).replace(/\\/g, "/"));
      }
    }
  } catch {
    // silently skip unreadable dirs
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface FileResult {
  file: string;
  lines: number;
  budget: number;
  rationale: string;
  disabled: boolean;
  disableReason: string | null;
  exceeded: boolean;
}

const allMdFiles = collectFiles(REPO_ROOT, REPO_ROOT);

const results: FileResult[] = [];

for (const budget of BUDGETS) {
  const matched = allMdFiles.filter((f) => matchGlob(budget.glob, f));
  for (const file of matched) {
    const fullPath = path.join(REPO_ROOT, file);
    const content = fs.readFileSync(fullPath, "utf8");
    const lines = content.split("\n").length;

    const disableMatch = content.match(/<!--\s*doc-size-lint-disable:\s*(.+?)\s*-->/);
    const disabled = disableMatch !== null;
    const disableReason = disableMatch ? disableMatch[1] : null;

    results.push({
      file,
      lines,
      budget: budget.budget,
      rationale: budget.rationale,
      disabled,
      disableReason,
      exceeded: lines > budget.budget,
    });
  }
}

// Sort: exceeded first, then by file name
results.sort((a, b) => {
  if (a.exceeded !== b.exceeded) return a.exceeded ? -1 : 1;
  return a.file.localeCompare(b.file);
});

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

let hasError = false;
const warnings: string[] = [];

for (const r of results) {
  if (SUMMARY_MODE) {
    const flag = r.exceeded && !r.disabled ? "✗" : r.exceeded && r.disabled ? "⚠" : "✓";
    console.log(`  ${flag} ${r.file}: ${r.lines} lines (budget: ${r.budget})`);
    continue;
  }

  if (r.exceeded && r.disabled) {
    warnings.push(
      `  ⚠ ${r.file}: ${r.lines} lines exceeds budget of ${r.budget} (suppressed: "${r.disableReason}"); ` +
        `consider trimming ${r.lines - r.budget} lines.`,
    );
  } else if (r.exceeded) {
    const gap = r.lines - r.budget;
    process.stderr.write(
      `\n::error file=${r.file}::${r.file} is ${r.lines} lines; budget is ${r.budget}; ` +
        `trim ${gap} line${gap === 1 ? "" : "s"} or split. ${r.rationale}.\n`,
    );
    hasError = true;
  }
}

if (warnings.length > 0) {
  process.stderr.write("\nWarnings (budget exceeded but suppressed via lint-disable comment):\n");
  for (const w of warnings) {
    process.stderr.write(`${w}\n`);
  }
}

if (!SUMMARY_MODE) {
  if (hasError) {
    process.stderr.write("\nlint-doc-sizes: budget exceeded — fix the files above.\n");
    process.exit(1);
  }
  // biome-ignore lint/suspicious/noConsole: intentional CLI output
  console.log(`lint-doc-sizes: all ${results.length} file(s) within budget.`);
}
