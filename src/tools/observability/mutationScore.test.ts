/**
 * Tests for `probeMutationScore` — Stryker calibration freshness probe.
 */

import { describe, expect, it, vi } from "vitest";
import { probeMutationScore } from "./mutationScore.js";

const FIXED_MTIME = new Date("2026-04-29T14:09:28Z");

function makeReport(counts: {
  killed?: number;
  survived?: number;
  timeout?: number;
  noCoverage?: number;
  compileError?: number;
}): string {
  const mutants: Array<{ status: string }> = [];
  for (let i = 0; i < (counts.killed ?? 0); i++) mutants.push({ status: "Killed" });
  for (let i = 0; i < (counts.survived ?? 0); i++) mutants.push({ status: "Survived" });
  for (let i = 0; i < (counts.timeout ?? 0); i++) mutants.push({ status: "Timeout" });
  for (let i = 0; i < (counts.noCoverage ?? 0); i++) mutants.push({ status: "NoCoverage" });
  for (let i = 0; i < (counts.compileError ?? 0); i++) mutants.push({ status: "CompileError" });
  return JSON.stringify({ files: { "src/foo.ts": { mutants } } });
}

function harness(opts: { exists?: boolean; contents?: string; mtime?: Date } = {}) {
  return {
    reportPath: "/tmp/mutation.json",
    existsSync: vi.fn().mockReturnValue(opts.exists ?? true),
    readFile: vi.fn().mockReturnValue(opts.contents ?? makeReport({})),
    stat: vi.fn().mockReturnValue({ mtime: opts.mtime ?? FIXED_MTIME }),
  };
}

describe("probeMutationScore", () => {
  it("returns null when the report file is absent", () => {
    const result = probeMutationScore(harness({ exists: false }));
    expect(result).toBeNull();
  });

  it("returns null when the report is malformed JSON", () => {
    const result = probeMutationScore(harness({ contents: "not-json" }));
    expect(result).toBeNull();
  });

  it("returns null when the report has zero countable mutants", () => {
    const result = probeMutationScore(harness({ contents: makeReport({ compileError: 5 }) }));
    expect(result).toBeNull();
  });

  it("computes Stryker's mutation score formula with the calibration baseline numbers", () => {
    // Slice 1B's calibration: killed=1119, survived=491, timeout=6, noCoverage=177.
    // (1119+6) / (1119+491+6+177) = 1125 / 1793 = 62.7440...%
    const result = probeMutationScore(
      harness({
        contents: makeReport({ killed: 1119, survived: 491, timeout: 6, noCoverage: 177 }),
      }),
    );
    expect(result).not.toBeNull();
    expect(result?.score).toBeCloseTo(62.744, 3);
  });

  it("ignores compile-error and runtime-error mutants in the score denominator", () => {
    // Adding 947 compile errors should not change the score — they aren't
    // valid mutants and Stryker's formula excludes them.
    const result = probeMutationScore(
      harness({
        contents: makeReport({
          killed: 1119,
          survived: 491,
          timeout: 6,
          noCoverage: 177,
          compileError: 947,
        }),
      }),
    );
    expect(result?.score).toBeCloseTo(62.744, 3);
  });

  it("returns the file mtime as ISO-8601 lastRunAt", () => {
    const result = probeMutationScore(
      harness({ mtime: FIXED_MTIME, contents: makeReport({ killed: 1 }) }),
    );
    expect(result?.lastRunAt).toBe(FIXED_MTIME.toISOString());
  });

  it("returns 100 when every mutant is killed (perfect coverage)", () => {
    const result = probeMutationScore(harness({ contents: makeReport({ killed: 100 }) }));
    expect(result?.score).toBe(100);
  });

  it("returns 0 when no mutants were killed (no test pins down behaviour)", () => {
    const result = probeMutationScore(harness({ contents: makeReport({ survived: 100 }) }));
    expect(result?.score).toBe(0);
  });
});
