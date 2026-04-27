/**
 * Unit tests for src/domain/hints.ts
 *
 * Covers: builder helpers, capHints, filterHintsBySeverity, finaliseHints,
 * and each per-tool detector (repeatHintForName, estimateHintForDue,
 * inboxGrowthHint, reviewIntervalHint, projectEmptyHint).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  capHints,
  considerAlternativeHint,
  estimateHintForDue,
  filterHintsBySeverity,
  finaliseHints,
  inboxGrowthHint,
  missingDetailHint,
  nextNaturalStepHint,
  projectEmptyHint,
  repeatHintForName,
  reviewIntervalHint,
  staleDataHint,
  wouldConflictHint,
} from "./hints.js";

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

describe("hint builders", () => {
  it("missingDetailHint sets kind and reason", () => {
    const h = missingDetailHint("No estimate.");
    expect(h.kind).toBe("missing-detail");
    expect(h.reason).toBe("No estimate.");
    expect(h.severity).toBeUndefined();
  });

  it("wouldConflictHint carries severity warn", () => {
    const h = wouldConflictHint("Conflict.", { severity: "warn" });
    expect(h.kind).toBe("would-conflict");
    expect(h.severity).toBe("warn");
  });

  it("nextNaturalStepHint carries suggestedTool and suggestedArgs", () => {
    const h = nextNaturalStepHint("Follow-up.", {
      suggestedTool: "task_set_repetition",
      suggestedArgs: { id: "t1" },
    });
    expect(h.kind).toBe("next-natural-step");
    expect(h.suggestedTool).toBe("task_set_repetition");
    expect(h.suggestedArgs).toEqual({ id: "t1" });
  });

  it("considerAlternativeHint", () => {
    expect(considerAlternativeHint("Alt.").kind).toBe("consider-alternative");
  });

  it("staleDataHint", () => {
    expect(staleDataHint("Stale.").kind).toBe("stale-data");
  });
});

// ---------------------------------------------------------------------------
// capHints
// ---------------------------------------------------------------------------

describe("capHints", () => {
  it("returns all hints when under cap", () => {
    const hints = [missingDetailHint("a"), missingDetailHint("b")];
    expect(capHints(hints, 3)).toHaveLength(2);
  });

  it("truncates to max when over cap", () => {
    const hints = Array.from({ length: 5 }, (_, i) => missingDetailHint(`hint ${i}`));
    expect(capHints(hints, 3)).toHaveLength(3);
  });

  it("prefers warn-severity hints over info when capping", () => {
    const info1 = missingDetailHint("info 1", { severity: "info" });
    const info2 = missingDetailHint("info 2", { severity: "info" });
    const warn = wouldConflictHint("warn!", { severity: "warn" });
    const info3 = missingDetailHint("info 3", { severity: "info" });
    const result = capHints([info1, info2, warn, info3], 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(warn);
  });

  it("respects default cap of 3", () => {
    const hints = Array.from({ length: 6 }, (_, i) => missingDetailHint(`h ${i}`));
    expect(capHints(hints)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// filterHintsBySeverity
// ---------------------------------------------------------------------------

describe("filterHintsBySeverity", () => {
  const original = process.env.OMNIFOCUS_HINT_LEVEL;

  beforeEach(() => {
    delete process.env.OMNIFOCUS_HINT_LEVEL;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.OMNIFOCUS_HINT_LEVEL;
    } else {
      process.env.OMNIFOCUS_HINT_LEVEL = original;
    }
  });

  it("returns all hints when env is unset", () => {
    const hints = [missingDetailHint("a"), wouldConflictHint("b", { severity: "warn" })];
    expect(filterHintsBySeverity(hints)).toHaveLength(2);
  });

  it("strips info hints when OMNIFOCUS_HINT_LEVEL=warn", () => {
    process.env.OMNIFOCUS_HINT_LEVEL = "warn";
    const hints = [
      missingDetailHint("info hint", { severity: "info" }),
      wouldConflictHint("warn hint", { severity: "warn" }),
    ];
    const result = filterHintsBySeverity(hints);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("would-conflict");
  });

  it("treats hints with no severity as info", () => {
    process.env.OMNIFOCUS_HINT_LEVEL = "warn";
    const hints = [missingDetailHint("no severity")]; // severity undefined → treated as info
    expect(filterHintsBySeverity(hints)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// finaliseHints
// ---------------------------------------------------------------------------

describe("finaliseHints", () => {
  it("returns undefined for empty array", () => {
    expect(finaliseHints([])).toBeUndefined();
  });

  it("returns undefined when all hints filtered out", () => {
    const original = process.env.OMNIFOCUS_HINT_LEVEL;
    process.env.OMNIFOCUS_HINT_LEVEL = "warn";
    try {
      const hints = [missingDetailHint("info only")];
      expect(finaliseHints(hints)).toBeUndefined();
    } finally {
      if (original === undefined) delete process.env.OMNIFOCUS_HINT_LEVEL;
      else process.env.OMNIFOCUS_HINT_LEVEL = original;
    }
  });

  it("caps to 3 by default", () => {
    const hints = Array.from({ length: 5 }, (_, i) => missingDetailHint(`h ${i}`));
    expect(finaliseHints(hints)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Per-tool detectors
// ---------------------------------------------------------------------------

describe("repeatHintForName", () => {
  it("returns undefined for non-recurring names", () => {
    expect(repeatHintForName("t1", "Buy groceries")).toBeUndefined();
    expect(repeatHintForName("t1", "Check email")).toBeUndefined();
  });

  it("fires for 'weekly' cue", () => {
    const h = repeatHintForName("t1", "Weekly team sync");
    expect(h).not.toBeUndefined();
    expect(h?.kind).toBe("next-natural-step");
    expect(h?.suggestedTool).toBe("task_set_repetition");
    expect(h?.suggestedArgs).toEqual({ id: "t1" });
  });

  it("fires for 'daily' cue", () => {
    expect(repeatHintForName("t1", "Daily standup")).not.toBeUndefined();
  });

  it("fires for 'every week' cue", () => {
    expect(repeatHintForName("t1", "Review goals every week")).not.toBeUndefined();
  });

  it("fires for 'every Monday' cue", () => {
    expect(repeatHintForName("t1", "Send report every Monday")).not.toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(repeatHintForName("t1", "WEEKLY REVIEW")).not.toBeUndefined();
  });
});

describe("estimateHintForDue", () => {
  it("returns undefined when no due date", () => {
    expect(estimateHintForDue("t1", undefined, undefined)).toBeUndefined();
  });

  it("returns undefined when estimate already set", () => {
    expect(estimateHintForDue("t1", "2026-05-01T09:00:00+00:00", 30)).toBeUndefined();
  });

  it("fires when due date set and no estimate", () => {
    const h = estimateHintForDue("t1", "2026-05-01T09:00:00+00:00", undefined);
    expect(h).not.toBeUndefined();
    expect(h?.kind).toBe("missing-detail");
    expect(h?.suggestedTool).toBe("task_update");
    expect(h?.suggestedArgs).toEqual({ id: "t1" });
  });
});

describe("inboxGrowthHint", () => {
  it("returns undefined below threshold", () => {
    expect(inboxGrowthHint(4)).toBeUndefined();
    expect(inboxGrowthHint(0)).toBeUndefined();
  });

  it("fires at exactly the threshold (default 5)", () => {
    const h = inboxGrowthHint(5);
    expect(h).not.toBeUndefined();
    expect(h?.kind).toBe("consider-alternative");
    expect(h?.reason).toContain("5");
  });

  it("fires above threshold", () => {
    expect(inboxGrowthHint(10)).not.toBeUndefined();
  });

  it("respects custom threshold", () => {
    expect(inboxGrowthHint(3, 10)).toBeUndefined();
    expect(inboxGrowthHint(10, 10)).not.toBeUndefined();
  });
});

describe("reviewIntervalHint", () => {
  it("returns undefined when review interval is already set", () => {
    expect(reviewIntervalHint("p1", 7)).toBeUndefined();
    expect(reviewIntervalHint("p1", 14)).toBeUndefined();
  });

  it("fires when no review interval", () => {
    const h = reviewIntervalHint("p1", undefined);
    expect(h).not.toBeUndefined();
    expect(h?.kind).toBe("next-natural-step");
    expect(h?.suggestedTool).toBe("project_update");
    expect(h?.suggestedArgs).toMatchObject({ id: "p1", reviewIntervalDays: 7 });
  });
});

describe("projectEmptyHint", () => {
  it("always returns a hint with the project name", () => {
    const h = projectEmptyHint("p1", "Errands");
    expect(h.kind).toBe("next-natural-step");
    expect(h.reason).toContain("Errands");
    expect(h.suggestedTool).toBe("project_complete");
    expect(h.suggestedArgs).toEqual({ id: "p1" });
  });
});
