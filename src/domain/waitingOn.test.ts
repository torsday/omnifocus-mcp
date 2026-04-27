import { describe, expect, it } from "vitest";
import {
  clearWaitingOn,
  daysOverdue,
  parseWaitingOn,
  WAITING_ON_FENCE,
  writeWaitingOn,
} from "./waitingOn.js";

describe("parseWaitingOn", () => {
  it("returns undefined for an empty or null note", () => {
    expect(parseWaitingOn(null)).toBeUndefined();
    expect(parseWaitingOn("")).toBeUndefined();
  });

  it("returns undefined when no waiting-on fence is present", () => {
    expect(parseWaitingOn("just user text")).toBeUndefined();
    expect(parseWaitingOn("```other\nfoo: bar\n```")).toBeUndefined();
  });

  it("parses a complete waiting-on fence", () => {
    const note =
      "```waiting-on\nwhom: Alice\nwhat: contract review\nsince: 2026-04-27T10:00:00-05:00\nfollowUpAfter: 2026-05-02T00:00:00-05:00\n```";
    expect(parseWaitingOn(note)).toEqual({
      whom: "Alice",
      what: "contract review",
      since: "2026-04-27T10:00:00-05:00",
      followUpAfter: "2026-05-02T00:00:00-05:00",
    });
  });

  it("parses a minimal fence (whom + since only)", () => {
    const note = "```waiting-on\nwhom: Alice\nsince: 2026-04-27T10:00:00-05:00\n```";
    expect(parseWaitingOn(note)).toEqual({
      whom: "Alice",
      since: "2026-04-27T10:00:00-05:00",
    });
  });

  it("degrades to undefined when whom is missing", () => {
    const note = "```waiting-on\nsince: 2026-04-27T10:00:00-05:00\n```";
    expect(parseWaitingOn(note)).toBeUndefined();
  });

  it("degrades to undefined when since is malformed", () => {
    const note = "```waiting-on\nwhom: Alice\nsince: yesterday\n```";
    expect(parseWaitingOn(note)).toBeUndefined();
  });

  it("ignores unrelated keys inside the fence", () => {
    const note = "```waiting-on\nwhom: Alice\nsince: 2026-04-27T10:00:00-05:00\nbogus: 42\n```";
    expect(parseWaitingOn(note)).toEqual({
      whom: "Alice",
      since: "2026-04-27T10:00:00-05:00",
    });
  });
});

describe("writeWaitingOn", () => {
  it("creates a fence in an empty note", () => {
    const out = writeWaitingOn(null, {
      whom: "Alice",
      since: "2026-04-27T10:00:00-05:00",
    });
    expect(out).toBe("```waiting-on\nwhom: Alice\nsince: 2026-04-27T10:00:00-05:00\n```");
  });

  it("preserves user text when prepending the fence", () => {
    const out = writeWaitingOn("user wrote this earlier", {
      whom: "Alice",
      since: "2026-04-27T10:00:00-05:00",
    });
    expect(out).toContain("user wrote this earlier");
    expect(out.startsWith("```waiting-on")).toBe(true);
  });

  it("replaces an existing fence rather than duplicating", () => {
    const initial = writeWaitingOn(null, {
      whom: "Alice",
      since: "2026-04-27T10:00:00-05:00",
    });
    const updated = writeWaitingOn(initial, {
      whom: "Bob",
      since: "2026-04-28T09:00:00-05:00",
    });
    const occurrences = updated.split("```waiting-on").length - 1;
    expect(occurrences).toBe(1);
    expect(parseWaitingOn(updated)?.whom).toBe("Bob");
  });

  it("emits stable field order: whom, what, since, followUpAfter", () => {
    const out = writeWaitingOn(null, {
      whom: "Alice",
      what: "contract review",
      since: "2026-04-27T10:00:00-05:00",
      followUpAfter: "2026-05-02T00:00:00-05:00",
    });
    const lines = out.split("\n").slice(1, -1);
    expect(lines).toEqual([
      "whom: Alice",
      "what: contract review",
      "since: 2026-04-27T10:00:00-05:00",
      "followUpAfter: 2026-05-02T00:00:00-05:00",
    ]);
  });

  it("omits absent optional fields from the fence", () => {
    const out = writeWaitingOn(null, {
      whom: "Alice",
      since: "2026-04-27T10:00:00-05:00",
    });
    expect(out).not.toContain("what:");
    expect(out).not.toContain("followUpAfter:");
  });
});

describe("clearWaitingOn", () => {
  it("returns null when the note had only the fence", () => {
    const note = writeWaitingOn(null, {
      whom: "Alice",
      since: "2026-04-27T10:00:00-05:00",
    });
    expect(clearWaitingOn(note)).toBeNull();
  });

  it("preserves surrounding user content when clearing the fence", () => {
    const note = writeWaitingOn("user prose", {
      whom: "Alice",
      since: "2026-04-27T10:00:00-05:00",
    });
    expect(clearWaitingOn(note)).toBe("user prose");
  });

  it("returns the note unchanged when no fence exists", () => {
    expect(clearWaitingOn("just user text")).toBe("just user text");
    expect(clearWaitingOn(null)).toBeNull();
  });
});

describe("daysOverdue", () => {
  const NOW = new Date("2026-04-27T15:00:00Z");

  it("returns null when followUpAfter is unset", () => {
    expect(daysOverdue({ whom: "Alice", since: "2026-04-20T00:00:00Z" }, NOW)).toBeNull();
  });

  it("returns null when followUpAfter is in the future", () => {
    expect(
      daysOverdue(
        {
          whom: "Alice",
          since: "2026-04-20T00:00:00Z",
          followUpAfter: "2026-05-10T00:00:00Z",
        },
        NOW,
      ),
    ).toBeNull();
  });

  it("returns 0 when followUpAfter passed earlier today", () => {
    expect(
      daysOverdue(
        {
          whom: "Alice",
          since: "2026-04-20T00:00:00Z",
          followUpAfter: "2026-04-27T00:00:00Z",
        },
        NOW,
      ),
    ).toBe(0);
  });

  it("returns the integer number of whole days past followUpAfter", () => {
    expect(
      daysOverdue(
        {
          whom: "Alice",
          since: "2026-04-01T00:00:00Z",
          followUpAfter: "2026-04-22T15:00:00Z",
        },
        NOW,
      ),
    ).toBe(5);
  });
});

describe("WAITING_ON_FENCE constant", () => {
  it("is the wire-stable fence tag", () => {
    expect(WAITING_ON_FENCE).toBe("waiting-on");
  });
});
