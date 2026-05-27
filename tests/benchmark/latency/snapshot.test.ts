import { describe, expect, test } from "vitest";
import { buildSnapshot, DRIFT_FAIL_PCT, diffSnapshots, formatDrift } from "./snapshot.js";
import type { WorkflowLatency } from "./types.js";

function wf(
  workflow: string,
  totalDurationMs: number,
  callCount: number,
  byScript: WorkflowLatency["byScript"] = {},
  spawnPctOfTotal = 0,
): WorkflowLatency {
  return { workflow, totalDurationMs, callCount, byScript, spawnPctOfTotal };
}

describe("buildSnapshot", () => {
  test("sorts workflows alphabetically for stable diffs", () => {
    const snap = buildSnapshot([wf("z-last", 10, 1), wf("a-first", 20, 2)]);
    expect(Object.keys(snap.workflows)).toEqual(["a-first", "z-last"]);
  });

  test("generatedAt is an ISO date (YYYY-MM-DD)", () => {
    const snap = buildSnapshot([wf("a", 1, 1)]);
    expect(snap.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("diffSnapshots", () => {
  const baseline = buildSnapshot([
    wf("inbox-triage", 1000, 10, {
      task_list: {
        count: 5,
        p50Ms: 100,
        p95Ms: 200,
        maxMs: 250,
        coldP95Ms: 250,
        warmP95Ms: 110,
      },
    }),
  ]);

  test("identical snapshots report no drift", () => {
    const same = buildSnapshot([
      wf("inbox-triage", 1000, 10, {
        task_list: {
          count: 5,
          p50Ms: 100,
          p95Ms: 200,
          maxMs: 250,
          coldP95Ms: 250,
          warmP95Ms: 110,
        },
      }),
    ]);
    expect(diffSnapshots(baseline, same)).toEqual([]);
  });

  test("noise under threshold passes silently", () => {
    const noisy = buildSnapshot([
      wf("inbox-triage", 1080, 10, {
        task_list: {
          count: 5,
          p50Ms: 105,
          p95Ms: 210, // +5% — under 15% gate
          maxMs: 255,
          coldP95Ms: 255,
          warmP95Ms: 115,
        },
      }),
    ]);
    expect(diffSnapshots(baseline, noisy)).toEqual([]);
  });

  test("regression beyond threshold is flagged", () => {
    const regressed = buildSnapshot([
      wf("inbox-triage", 1500, 10, {
        task_list: {
          count: 5,
          p50Ms: 100,
          p95Ms: 300, // +50% — over 15% gate
          maxMs: 350,
          coldP95Ms: 350,
          warmP95Ms: 150,
        },
      }),
    ]);
    const findings = diffSnapshots(baseline, regressed);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.path.includes("task_list.p95Ms"))).toBe(true);
    expect(findings.some((f) => f.path.includes("totalDurationMs"))).toBe(true);
  });

  test("symmetric: improvements beyond threshold also fail (forces re-baseline)", () => {
    const improved = buildSnapshot([
      wf("inbox-triage", 500, 10, {
        task_list: {
          count: 5,
          p50Ms: 50,
          p95Ms: 100, // -50%
          maxMs: 125,
          coldP95Ms: 125,
          warmP95Ms: 55,
        },
      }),
    ]);
    const findings = diffSnapshots(baseline, improved);
    expect(findings.length).toBeGreaterThan(0);
  });

  test("new workflow is flagged so reviewer notices the baseline gap", () => {
    const added = buildSnapshot([
      wf("inbox-triage", 1000, 10, {
        task_list: {
          count: 5,
          p50Ms: 100,
          p95Ms: 200,
          maxMs: 250,
          coldP95Ms: 250,
          warmP95Ms: 110,
        },
      }),
      wf("weekly-review", 800, 8),
    ]);
    const findings = diffSnapshots(baseline, added);
    expect(findings.some((f) => f.path.includes("weekly-review (new workflow)"))).toBe(true);
  });

  test("coldP95 is intentionally not gated — too noisy at single-iteration", () => {
    const coldDrift = buildSnapshot([
      wf("inbox-triage", 1000, 10, {
        task_list: {
          count: 5,
          p50Ms: 100,
          p95Ms: 200,
          maxMs: 250,
          coldP95Ms: 800, // 3x baseline cold — but the gate ignores cold
          warmP95Ms: 110,
        },
      }),
    ]);
    const findings = diffSnapshots(baseline, coldDrift);
    expect(findings.some((f) => f.path.includes("coldP95"))).toBe(false);
  });
});

describe("formatDrift", () => {
  test("empty findings produce the no-drift message at the configured threshold", () => {
    expect(formatDrift([])).toBe(`no drift ≥ ${DRIFT_FAIL_PCT}%`);
  });

  test("formats each finding with sign on the percentage", () => {
    const out = formatDrift([
      { path: "wf.script.p95Ms", baseline: 100, current: 150, driftPct: 50 },
      { path: "wf.script.warmP95Ms", baseline: 100, current: 70, driftPct: -30 },
    ]);
    expect(out).toContain("+50.0%");
    expect(out).toContain("-30.0%");
  });
});
