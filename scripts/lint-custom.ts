#!/usr/bin/env tsx
/**
 * Custom lint runner for omnifocus-mcp.
 * Calls the rule logic in src/linting/customRules.ts over all source files.
 * Exit code: 0 = clean, 1 = violations found.
 */

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { checkFileContent, type Violation } from "../src/linting/customRules.js";

async function collectSourceFiles(dir = "src"): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    if (e.name === "node_modules") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...(await collectSourceFiles(full)));
    } else if (e.isFile() && /\.(ts|js)$/.test(e.name)) {
      files.push(full);
    }
  }
  return files.sort();
}

async function main(): Promise<void> {
  const files = await collectSourceFiles();
  const allViolations: Violation[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    allViolations.push(...checkFileContent(file, content));
  }

  if (allViolations.length === 0) {
    process.stderr.write("lint-custom: no violations found\n");
    process.exit(0);
  }

  for (const v of allViolations) {
    process.stderr.write(`${relative(process.cwd(), v.file)}:${v.line} [${v.rule}] ${v.excerpt}\n`);
  }

  process.stderr.write(`\nlint-custom: ${allViolations.length} violation(s) found\n`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`lint-custom: fatal error: ${String(err)}\n`);
  process.exit(1);
});
