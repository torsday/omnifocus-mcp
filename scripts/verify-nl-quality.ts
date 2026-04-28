#!/usr/bin/env tsx
/**
 * verify-nl-quality.ts — enforce the NL-quality rubric at lint time.
 *
 * Two checks, run over every file under `src/tools/` (excluding `*.test.ts`):
 *
 *   1. **DESCRIPTION floor.** Every `*_DESCRIPTION` string constant exported
 *      from a tool module is at least 200 characters AND contains the
 *      substring `Example:` somewhere. The 200-char floor is a heuristic
 *      pulled from existing well-formed descriptions; agents do measurably
 *      worse below it (`docs/nl-quality-standards.md` §2). The `Example:`
 *      substring is the pinned worked-call template — see same doc.
 *
 *   2. **Zod field describes.** Every field on every `*InputSchema` /
 *      `*InputBaseSchema` (the agent-facing input schema by convention
 *      across this codebase) carries a `.describe(...)` call. A bare
 *      `z.string()` with no describe shows up to the agent as a typed slot
 *      with no semantic hint — the agent has to guess from the field name
 *      (`docs/nl-quality-standards.md` §1).
 *
 * # Allowlist
 *
 * Day-1 reality: nearly every existing tool was written before this rubric
 * existed. The audit-and-remediation pass (#563) graduates them one by one.
 * Until then, files in `scripts/nl-quality-allowlist.json` are exempt from
 * BOTH rules — it's a coarse-grained per-file pass. Removing a path from
 * the allowlist is the explicit "this tool now meets the rubric" signal.
 *
 * The allowlist file lives next to this script and is committed. Its shape:
 *
 *   {
 *     "exempt": [
 *       "src/tools/task/foo.ts",
 *       ...
 *     ]
 *   }
 *
 * # Why TS compiler API and not ts-morph
 *
 * `typescript` is already a dev-dep; ts-morph adds another ~1.5 MB to
 * `node_modules`. The compiler API is verbose but does exactly what's
 * needed here. Pattern matched against existing `scripts/lint-custom.ts`
 * for consistency.
 *
 * # Exit codes
 *
 *   0 — all clean.
 *   1 — at least one non-allowlisted violation; report on stderr.
 *
 * @see docs/nl-quality-standards.md — the rubric this enforces
 * @see scripts/nl-quality-allowlist.json — files exempt during the audit
 * @see #564 — issue tracking this lint
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS_ROOT = join(REPO_ROOT, "src", "tools");
const ALLOWLIST_PATH = join(REPO_ROOT, "scripts", "nl-quality-allowlist.json");

const DESCRIPTION_MIN_CHARS = 200;
const DESCRIPTION_REGEX = /_DESCRIPTION$/;
const INPUT_SCHEMA_REGEX = /InputSchema$|InputBaseSchema$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Violation {
  /** Repo-relative path. */
  file: string;
  rule: "description-floor" | "zod-describe";
  message: string;
}

interface Allowlist {
  exempt: readonly string[];
}

// ---------------------------------------------------------------------------
// Allowlist loader
// ---------------------------------------------------------------------------

function loadAllowlist(): Set<string> {
  try {
    const raw = readFileSync(ALLOWLIST_PATH, "utf8");
    const parsed = JSON.parse(raw) as Allowlist;
    if (!Array.isArray(parsed.exempt)) {
      throw new Error(`${ALLOWLIST_PATH}: \`exempt\` must be an array`);
    }
    return new Set(parsed.exempt);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      // No allowlist yet — treat as empty.
      return new Set();
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// File walker — gather candidate files under src/tools
// ---------------------------------------------------------------------------

function collectToolFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectToolFiles(full));
    } else if (
      st.isFile() &&
      full.endsWith(".ts") &&
      !full.endsWith(".test.ts") &&
      !full.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

/**
 * Concatenated string-literal initializer — collapses `"a" + "b" + "c"` into
 * the runtime value an agent would actually receive. Returns null when the
 * initializer is anything else (e.g. a function call, identifier ref).
 */
function flattenStringInitializer(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = flattenStringInitializer(node.left);
    const right = flattenStringInitializer(node.right);
    if (left === null || right === null) return null;
    return left + right;
  }
  return null;
}

/**
 * True when the call chain rooted at `expr` includes a `.describe(...)` call.
 * Walks both direct chains (`z.string().describe(...)`) and chains broken by
 * other modifiers (`z.array(...).optional().describe(...)`).
 */
function callChainContainsDescribe(expr: ts.Expression): boolean {
  let cursor: ts.Node = expr;
  while (ts.isCallExpression(cursor) || ts.isPropertyAccessExpression(cursor)) {
    if (
      ts.isCallExpression(cursor) &&
      ts.isPropertyAccessExpression(cursor.expression) &&
      cursor.expression.name.text === "describe"
    ) {
      return true;
    }
    cursor = ts.isCallExpression(cursor)
      ? cursor.expression
      : (cursor as ts.PropertyAccessExpression).expression;
  }
  return false;
}

/**
 * Find the `z.object({ ... })` ObjectLiteralExpression nested somewhere in
 * `expr`. Returns null if the schema isn't a z.object literal (could be
 * `BaseSchema.extend({ ... })`, a refined schema, an imported schema, etc.).
 */
function findZObjectArg(expr: ts.Expression): ts.ObjectLiteralExpression | null {
  // Direct match: `z.object({ ... })`
  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.name.text === "object" &&
    expr.arguments.length >= 1
  ) {
    const arg = expr.arguments[0];
    if (arg && ts.isObjectLiteralExpression(arg)) return arg;
  }

  // Chained: descend through `.refine`, `.extend`, etc. to the underlying
  // z.object. Stop at the first match.
  if (ts.isCallExpression(expr)) {
    return findZObjectArg(expr.expression);
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return findZObjectArg(expr.expression);
  }
  return null;
}

// ---------------------------------------------------------------------------
// File-level checks
// ---------------------------------------------------------------------------

/**
 * Pure check over file contents — exported for unit tests so fixture strings
 * can be exercised without filesystem setup. Mirrors `lint-custom`'s shape.
 *
 * @param repoRel - the path used in the violation reports (typically a repo-
 *   relative path; tests can pass any string).
 * @param source - the file contents to scan.
 */
export function checkFileContent(repoRel: string, source: string): Violation[] {
  const sf = ts.createSourceFile(repoRel, source, ts.ScriptTarget.Latest, true);
  const violations: Violation[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const name = decl.name.text;

      // Rule 1: *_DESCRIPTION string constant
      if (isExported && DESCRIPTION_REGEX.test(name)) {
        const text = flattenStringInitializer(decl.initializer);
        if (text === null) {
          // Computed description — the lint can't check it; flag it explicitly
          // rather than passing silently.
          violations.push({
            file: repoRel,
            rule: "description-floor",
            message: `${name}: not a static string literal — cannot lint NL quality`,
          });
        } else {
          if (text.length < DESCRIPTION_MIN_CHARS) {
            violations.push({
              file: repoRel,
              rule: "description-floor",
              message: `${name}: ${text.length} chars (need ≥ ${DESCRIPTION_MIN_CHARS})`,
            });
          }
          if (!text.includes("Example:")) {
            violations.push({
              file: repoRel,
              rule: "description-floor",
              message: `${name}: missing 'Example:' (rubric §2 — worked example)`,
            });
          }
        }
      }

      // Rule 2: *InputSchema / *InputBaseSchema z.object fields
      if (INPUT_SCHEMA_REGEX.test(name)) {
        const obj = findZObjectArg(decl.initializer);
        if (obj === null) continue; // schema isn't a z.object literal — out of scope
        for (const prop of obj.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const fieldName = ts.isIdentifier(prop.name)
            ? prop.name.text
            : ts.isStringLiteral(prop.name)
              ? prop.name.text
              : "<unknown>";
          if (!callChainContainsDescribe(prop.initializer)) {
            violations.push({
              file: repoRel,
              rule: "zod-describe",
              message: `${name}.${fieldName}: missing .describe(...) (rubric §1)`,
            });
          }
        }
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const allowlist = loadAllowlist();
  const files = collectToolFiles(TOOLS_ROOT);

  const allViolations: Violation[] = [];
  const allowlistedFiles = new Set<string>();

  for (const abs of files) {
    const repoRel = relative(REPO_ROOT, abs);
    if (allowlist.has(repoRel)) {
      allowlistedFiles.add(repoRel);
      continue; // exempt — see allowlist file for graduation tracking
    }
    const source = readFileSync(abs, "utf8");
    allViolations.push(...checkFileContent(repoRel, source));
  }

  // Detect stale allowlist entries (file in allowlist but doesn't exist).
  // A stale entry suggests a removed/renamed file; surface so the audit
  // catches it, but don't fail CI on it.
  const presentFiles = new Set(files.map((f) => relative(REPO_ROOT, f)));
  for (const exempt of allowlist) {
    if (!presentFiles.has(exempt)) {
      process.stderr.write(
        `::warning::nl-quality allowlist entry has no matching file: ${exempt}\n`,
      );
    }
  }

  if (allViolations.length === 0) {
    const exempt = allowlistedFiles.size;
    process.stderr.write(
      `verify-nl-quality: clean (${files.length - exempt} enforced, ${exempt} allowlisted)\n`,
    );
    process.exit(0);
  }

  process.stderr.write(`verify-nl-quality: ${allViolations.length} violation(s):\n`);
  for (const v of allViolations) {
    process.stderr.write(`  ${v.file}: [${v.rule}] ${v.message}\n`);
  }
  process.stderr.write(
    `\nFix in place, or add the file to scripts/nl-quality-allowlist.json with a follow-up note.\n`,
  );
  process.exit(1);
}

// Only run when invoked as a script. Importing for tests skips this block.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
