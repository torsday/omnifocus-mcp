/**
 * Unit tests for proseExtractor — fixture-driven.
 *
 * Adding a new pattern to the extractor means adding a fixture here.
 * Tests cover numbered/bulleted/emoji matching, imperative-verb prefixes
 * with optional pleasantries, source-line provenance, the unmapped bucket,
 * and customising the verb allowlist.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMPERATIVE_VERBS,
  type ExtractionResult,
  extractTasksFromProse,
} from "./proseExtractor.js";

// ---------------------------------------------------------------------------
// Numbered + bullet + emoji
// ---------------------------------------------------------------------------

describe("extractTasksFromProse — numbered list", () => {
  it("extracts '1. foo' style", () => {
    const result = extractTasksFromProse("1. Send the report\n2. File the receipts");
    expect(result.proposed).toEqual([
      { name: "Send the report", sourceLines: [1] },
      { name: "File the receipts", sourceLines: [2] },
    ]);
    expect(result.unmappedLines).toEqual([]);
  });

  it("extracts '1) foo' style", () => {
    const result = extractTasksFromProse("1) Draft the memo");
    expect(result.proposed).toEqual([{ name: "Draft the memo", sourceLines: [1] }]);
  });

  it("extracts '(1) foo' style", () => {
    const result = extractTasksFromProse("(1) Review the PR");
    expect(result.proposed).toEqual([{ name: "Review the PR", sourceLines: [1] }]);
  });
});

describe("extractTasksFromProse — bullet list", () => {
  it("extracts '- foo' style", () => {
    const result = extractTasksFromProse("- Email Maria\n- Schedule one-on-one");
    expect(result.proposed).toEqual([
      { name: "Email Maria", sourceLines: [1] },
      { name: "Schedule one-on-one", sourceLines: [2] },
    ]);
  });

  it("extracts '* foo' style", () => {
    const result = extractTasksFromProse("* Plan the offsite");
    expect(result.proposed).toEqual([{ name: "Plan the offsite", sourceLines: [1] }]);
  });

  it("extracts '• foo' style (Unicode bullet)", () => {
    const result = extractTasksFromProse("• Build the demo deck");
    expect(result.proposed).toEqual([{ name: "Build the demo deck", sourceLines: [1] }]);
  });

  it("extracts en-dash and em-dash bullets", () => {
    const result = extractTasksFromProse("– Check the logs\n— Send the wrap");
    expect(result.proposed).toEqual([
      { name: "Check the logs", sourceLines: [1] },
      { name: "Send the wrap", sourceLines: [2] },
    ]);
  });
});

describe("extractTasksFromProse — action emoji", () => {
  it("extracts ✅ prefix", () => {
    const result = extractTasksFromProse("✅ Cancel the standing meeting");
    expect(result.proposed).toEqual([{ name: "Cancel the standing meeting", sourceLines: [1] }]);
  });

  it("extracts ⏰ prefix", () => {
    const result = extractTasksFromProse("⏰ Set up calendar reminder");
    expect(result.proposed).toEqual([{ name: "Set up calendar reminder", sourceLines: [1] }]);
  });
});

// ---------------------------------------------------------------------------
// Imperative-verb prefix
// ---------------------------------------------------------------------------

describe("extractTasksFromProse — imperative verbs", () => {
  it("extracts a bare imperative line", () => {
    const result = extractTasksFromProse("Email the team about the launch");
    expect(result.proposed).toEqual([
      { name: "Email the team about the launch", sourceLines: [1] },
    ]);
  });

  it("strips trailing period from extracted name", () => {
    const result = extractTasksFromProse("Send the spec to Lex.");
    expect(result.proposed).toEqual([{ name: "Send the spec to Lex", sourceLines: [1] }]);
  });

  it("recognises 'I should' as a pleasantry prefix", () => {
    const result = extractTasksFromProse("I should review the PR");
    expect(result.proposed).toEqual([{ name: "review the PR", sourceLines: [1] }]);
  });

  it("recognises 'please' as a pleasantry prefix", () => {
    const result = extractTasksFromProse("please send the deck");
    expect(result.proposed).toEqual([{ name: "send the deck", sourceLines: [1] }]);
  });

  it("recognises 'we need to' as a pleasantry prefix", () => {
    const result = extractTasksFromProse("we need to fix the deploy script");
    expect(result.proposed).toEqual([{ name: "fix the deploy script", sourceLines: [1] }]);
  });

  it("matches case-insensitively", () => {
    const result = extractTasksFromProse("FOLLOW UP with vendor");
    expect(result.proposed).toEqual([{ name: "FOLLOW UP with vendor", sourceLines: [1] }]);
  });

  it("preserves multi-word verb in the extracted name", () => {
    const result = extractTasksFromProse("set up the staging environment");
    expect(result.proposed).toEqual([{ name: "set up the staging environment", sourceLines: [1] }]);
  });
});

// ---------------------------------------------------------------------------
// Unmapped bucket
// ---------------------------------------------------------------------------

describe("extractTasksFromProse — unmapped lines", () => {
  it("preserves non-matching lines in unmappedLines with L{n}: prefix", () => {
    const result = extractTasksFromProse("Some context here\n- An action\nMore context");
    expect(result.proposed).toEqual([{ name: "An action", sourceLines: [2] }]);
    expect(result.unmappedLines).toEqual(["L1: Some context here", "L3: More context"]);
  });

  it("skips blank lines silently — no entry in proposed or unmapped", () => {
    const result = extractTasksFromProse("\n\n- Alpha\n\n- Beta\n\n");
    expect(result.proposed).toEqual([
      { name: "Alpha", sourceLines: [3] },
      { name: "Beta", sourceLines: [5] },
    ]);
    expect(result.unmappedLines).toEqual([]);
  });

  it("demotes empty-after-trim numbered items to unmapped", () => {
    const result = extractTasksFromProse("1. .\n2. Real task");
    expect(result.proposed).toEqual([{ name: "Real task", sourceLines: [2] }]);
    expect(result.unmappedLines).toContain("L1: 1. .");
  });

  it("normalises CRLF line endings", () => {
    const result = extractTasksFromProse("- A\r\n- B\r\n");
    expect(result.proposed).toEqual([
      { name: "A", sourceLines: [1] },
      { name: "B", sourceLines: [2] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Mixed input (realistic meeting note)
// ---------------------------------------------------------------------------

describe("extractTasksFromProse — meeting-note fixture", () => {
  it("extracts mixed-format actions while preserving line provenance", () => {
    const note = [
      "Meeting notes — 2026-04-26",
      "",
      "Attendees: Alex, Sam, Jamie",
      "",
      "Action items:",
      "1. Send the launch deck to legal by Friday",
      "2. Schedule a follow-up with the design team",
      "",
      "Risks discussed:",
      "- Build the load-test harness before next sprint",
      "- We need to fix the rollback script",
      "",
      "Open questions:",
      "Why did the deploy fail last Tuesday?",
    ].join("\n");

    const result = extractTasksFromProse(note);

    expect(result.proposed).toEqual([
      { name: "Send the launch deck to legal by Friday", sourceLines: [6] },
      { name: "Schedule a follow-up with the design team", sourceLines: [7] },
      { name: "Build the load-test harness before next sprint", sourceLines: [10] },
      { name: "We need to fix the rollback script", sourceLines: [11] },
    ]);

    // Context lines surface in unmapped — agent decides whether to use them.
    expect(result.unmappedLines).toEqual([
      "L1: Meeting notes — 2026-04-26",
      "L3: Attendees: Alex, Sam, Jamie",
      "L5: Action items:",
      "L9: Risks discussed:",
      "L13: Open questions:",
      "L14: Why did the deploy fail last Tuesday?",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Custom verb allowlist
// ---------------------------------------------------------------------------

describe("extractTasksFromProse — verb override", () => {
  it("respects a custom verb allowlist", () => {
    const result = extractTasksFromProse("ping the SRE channel\nemail Maria", {
      verbs: ["ping"],
    });
    expect(result.proposed).toEqual([{ name: "ping the SRE channel", sourceLines: [1] }]);
    expect(result.unmappedLines).toEqual(["L2: email Maria"]);
  });

  it("DEFAULT_IMPERATIVE_VERBS is non-empty (sanity)", () => {
    expect(DEFAULT_IMPERATIVE_VERBS.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Empty / whitespace input
// ---------------------------------------------------------------------------

describe("extractTasksFromProse — edge cases", () => {
  it("returns empty result for empty input", () => {
    const result: ExtractionResult = extractTasksFromProse("");
    expect(result.proposed).toEqual([]);
    expect(result.unmappedLines).toEqual([]);
  });

  it("returns empty result for whitespace-only input", () => {
    const result = extractTasksFromProse("   \n\n   \n");
    expect(result.proposed).toEqual([]);
    expect(result.unmappedLines).toEqual([]);
  });
});
