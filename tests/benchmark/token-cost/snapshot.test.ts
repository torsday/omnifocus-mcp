/**
 * Unit tests for the token-cost snapshot gate (#1075).
 *
 * The point of #1075: `toolListBytes` is environment-sensitive and must NOT
 * fail the gate, while real per-workflow response-size regressions still must.
 * Runs in the normal suite (unlike run.test.ts, which is OMNIFOCUS_BENCH-gated).
 */

import { describe, expect, it } from "vitest";
import {
  diffSnapshots,
  resolveVersions,
  type SnapshotPayload,
  toolListBytesDrift,
} from "./snapshot.js";

function snap(over: Partial<SnapshotPayload> = {}): SnapshotPayload {
  return {
    generatedAt: "2026-06-04",
    toolListBytes: 100_000,
    workflows: {
      "inbox-triage": {
        callCount: 3,
        totalRequestBytes: 100,
        totalResponseBytes: 5000,
        totalRoundTripBytes: 5100,
        totalTokens: 1275,
        byTool: {},
      },
    },
    ...over,
  };
}

describe("diffSnapshots — toolListBytes is not gated (#1075)", () => {
  it("does not fail on a large toolListBytes-only difference", () => {
    const baseline = snap({ toolListBytes: 189_728 });
    const current = snap({ toolListBytes: 247_910 }); // +30.7%, the runner inflation
    expect(diffSnapshots(baseline, current)).toEqual([]);
  });

  it("still fails on a real per-workflow response-size regression", () => {
    const baseline = snap();
    const current = snap({
      workflows: {
        "inbox-triage": {
          callCount: 3,
          totalRequestBytes: 100,
          totalResponseBytes: 7000, // +40%
          totalRoundTripBytes: 7100,
          totalTokens: 1775,
          byTool: {},
        },
      },
    });
    const drift = diffSnapshots(baseline, current);
    expect(drift.map((d) => d.path)).toContain("inbox-triage.totalResponseBytes");
  });
});

describe("toolListBytesDrift — advisory", () => {
  it("reports drift without it being in the gated set", () => {
    const baseline = snap({ toolListBytes: 189_728 });
    const current = snap({ toolListBytes: 247_910 });
    const advisory = toolListBytesDrift(baseline, current);
    expect(advisory?.path).toBe("toolListBytes (advisory)");
    expect(advisory?.driftPct).toBeGreaterThan(5);
  });

  it("returns null when within threshold", () => {
    expect(toolListBytesDrift(snap(), snap())).toBeNull();
  });
});

describe("resolveVersions (#1075)", () => {
  it("records the resolved node + zod versions", () => {
    const v = resolveVersions();
    expect(v.node).toBe(process.versions.node);
    expect(v.zod).toMatch(/^\d+\.\d+\.\d+/);
  });
});
