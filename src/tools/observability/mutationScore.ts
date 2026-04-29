/**
 * Probe the latest Stryker mutation-testing report (per ADR-0017).
 *
 * Reads `<package-root>/reports/mutation/mutation.json` and computes the
 * mutation score using Stryker's standard formula. Returns `null` when no
 * report file exists — published npm tarballs do not ship the report
 * (`reports/` is gitignored), so the field naturally degrades to `null`
 * for end-user installs while remaining live for dev / CI clones.
 *
 * Score formula (matches Stryker's `mutationScore` metric):
 *   (killed + timeout) / (killed + survived + timeout + noCoverage)
 * Compile errors and runtime errors are excluded — they're invalid mutants,
 * not signal about test quality.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface MutationScoreSnapshot {
  /** Stryker mutation score expressed as a percentage (0–100). */
  score: number;
  /** ISO-8601 mtime of the report file. Approximates "last run at". */
  lastRunAt: string;
}

export interface ProbeMutationScoreOptions {
  /** Override the report path — primarily for tests. */
  reportPath?: string;
  /** Override `fs.readFileSync` — primarily for tests. */
  readFile?: (p: string) => string;
  /** Override `fs.statSync` — primarily for tests. */
  stat?: (p: string) => { mtime: Date };
  /** Override `fs.existsSync` — primarily for tests. */
  existsSync?: (p: string) => boolean;
}

/**
 * Resolve the default report path relative to this file's location so it
 * works identically in `src/` (tsx dev) and `dist/` (compiled) layouts:
 *   src/tools/observability/mutationScore.ts  →  ../../../reports/mutation/mutation.json
 *   dist/tools/observability/mutationScore.js →  ../../../reports/mutation/mutation.json
 */
function defaultReportPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(thisFile), "../../../reports/mutation/mutation.json");
}

interface MutantStatusCounts {
  Killed: number;
  Survived: number;
  Timeout: number;
  NoCoverage: number;
}

function countStatuses(report: unknown): MutantStatusCounts {
  const counts: MutantStatusCounts = { Killed: 0, Survived: 0, Timeout: 0, NoCoverage: 0 };
  const files = (report as { files?: Record<string, { mutants?: Array<{ status?: string }> }> })
    .files;
  if (!files) return counts;
  for (const file of Object.values(files)) {
    for (const mutant of file.mutants ?? []) {
      const s = mutant.status;
      if (s === "Killed") counts.Killed++;
      else if (s === "Survived") counts.Survived++;
      else if (s === "Timeout") counts.Timeout++;
      else if (s === "NoCoverage") counts.NoCoverage++;
    }
  }
  return counts;
}

/**
 * Read the most-recent Stryker report and return a calibration snapshot,
 * or `null` if the report file is absent or malformed.
 */
export function probeMutationScore(
  opts: ProbeMutationScoreOptions = {},
): MutationScoreSnapshot | null {
  const reportPath = opts.reportPath ?? defaultReportPath();
  const existsSync = opts.existsSync ?? fs.existsSync;
  if (!existsSync(reportPath)) return null;

  const readFile = opts.readFile ?? ((p: string) => fs.readFileSync(p, "utf8"));
  const stat = opts.stat ?? fs.statSync;

  let report: unknown;
  try {
    report = JSON.parse(readFile(reportPath));
  } catch {
    return null;
  }

  const { Killed, Survived, Timeout, NoCoverage } = countStatuses(report);
  const denom = Killed + Survived + Timeout + NoCoverage;
  if (denom === 0) return null;

  const score = ((Killed + Timeout) / denom) * 100;
  const lastRunAt = stat(reportPath).mtime.toISOString();
  return { score, lastRunAt };
}
