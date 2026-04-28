import { describe, expect, it } from "vitest";
import {
  findFence,
  parseFenceBody,
  removeFence,
  serializeFenceBody,
  upsertFence,
} from "./noteFences.js";

describe("findFence", () => {
  it("returns undefined for null or empty notes", () => {
    expect(findFence(null, "waiting-on")).toBeUndefined();
    expect(findFence("", "waiting-on")).toBeUndefined();
  });

  it("returns undefined when no matching fence exists", () => {
    expect(findFence("just a note\nwith two lines", "waiting-on")).toBeUndefined();
  });

  it("locates a fence at the start of the note", () => {
    const note = "```waiting-on\nwhom: Alice\n```\n\nrest of note";
    const m = findFence(note, "waiting-on");
    expect(m?.body).toBe("whom: Alice");
    expect(note.slice(m?.start, m?.end)).toBe("```waiting-on\nwhom: Alice\n```");
  });

  it("locates a fence in the middle of the note", () => {
    const note = "intro paragraph\n\n```waiting-on\nwhom: Alice\n```\n\nfollowup";
    const m = findFence(note, "waiting-on");
    expect(m?.body).toBe("whom: Alice");
  });

  it("ignores inline triple backticks not at line start", () => {
    const note = "see ```waiting-on inline``` not a fence";
    expect(findFence(note, "waiting-on")).toBeUndefined();
  });

  it("ignores fences with the wrong tag", () => {
    const note = "```decision\nfoo: bar\n```";
    expect(findFence(note, "waiting-on")).toBeUndefined();
  });

  it("returns undefined when the closing fence is missing", () => {
    const note = "```waiting-on\nwhom: Alice\n";
    expect(findFence(note, "waiting-on")).toBeUndefined();
  });
});

describe("parseFenceBody", () => {
  it("returns an empty object for an empty body", () => {
    expect(parseFenceBody("")).toEqual({});
  });

  it("parses simple key: value lines", () => {
    expect(parseFenceBody("whom: Alice\nwhat: contract review")).toEqual({
      whom: "Alice",
      what: "contract review",
    });
  });

  it("trims whitespace around keys and values", () => {
    expect(parseFenceBody("  whom :   Alice   ")).toEqual({ whom: "Alice" });
  });

  it("strips matching surrounding quotes", () => {
    expect(parseFenceBody("whom: \"Alice Cooper\"\nwhat: 'rock star'")).toEqual({
      whom: "Alice Cooper",
      what: "rock star",
    });
  });

  it("preserves colons in values past the first one", () => {
    expect(parseFenceBody("since: 2026-04-27T10:00:00-05:00")).toEqual({
      since: "2026-04-27T10:00:00-05:00",
    });
  });

  it("skips blank lines and lines without colons", () => {
    expect(parseFenceBody("whom: Alice\n\njust a comment\nwhat: review")).toEqual({
      whom: "Alice",
      what: "review",
    });
  });

  it("last write wins on duplicate keys", () => {
    expect(parseFenceBody("whom: Alice\nwhom: Bob")).toEqual({ whom: "Bob" });
  });
});

describe("serializeFenceBody", () => {
  it("emits key: value lines preserving insertion order", () => {
    expect(serializeFenceBody({ whom: "Alice", what: "review" })).toBe("whom: Alice\nwhat: review");
  });

  it("omits undefined values entirely", () => {
    expect(serializeFenceBody({ whom: "Alice", what: undefined, since: "now" })).toBe(
      "whom: Alice\nsince: now",
    );
  });
});

describe("upsertFence", () => {
  it("creates the fence in an empty note", () => {
    expect(upsertFence(null, "waiting-on", "whom: Alice")).toBe("```waiting-on\nwhom: Alice\n```");
    expect(upsertFence("", "waiting-on", "whom: Alice")).toBe("```waiting-on\nwhom: Alice\n```");
  });

  it("prepends the fence with a blank-line separator on a non-empty note", () => {
    expect(upsertFence("existing user content", "waiting-on", "whom: Alice")).toBe(
      "```waiting-on\nwhom: Alice\n```\n\nexisting user content",
    );
  });

  it("replaces an existing fence in place without disturbing surrounding text", () => {
    const note = "```waiting-on\nwhom: Alice\n```\n\nuser content\n\nmore content here";
    const updated = upsertFence(note, "waiting-on", "whom: Bob\nsince: 2026-04-27");
    expect(updated).toBe(
      "```waiting-on\nwhom: Bob\nsince: 2026-04-27\n```\n\nuser content\n\nmore content here",
    );
  });

  it("does not touch fences with different tags", () => {
    const note = "```other\nfoo: bar\n```\n\nuser text";
    const out = upsertFence(note, "waiting-on", "whom: Alice");
    expect(out).toContain("```other\nfoo: bar\n```");
    expect(out).toContain("```waiting-on\nwhom: Alice\n```");
  });

  it("round-trips through findFence + parseFenceBody", () => {
    const fields = { whom: "Alice", since: "2026-04-27T10:00:00-05:00" };
    const note = upsertFence("user note", "waiting-on", serializeFenceBody(fields));
    const m = findFence(note, "waiting-on");
    // biome-ignore lint/style/noNonNullAssertion: findFence always returns a match here
    expect(parseFenceBody(m!.body)).toEqual(fields);
  });
});

describe("removeFence", () => {
  it("returns null for null input", () => {
    expect(removeFence(null, "waiting-on")).toBeNull();
  });

  it("returns the original note when no fence exists", () => {
    expect(removeFence("just text", "waiting-on")).toBe("just text");
  });

  it("returns null when removing the only content of the note", () => {
    expect(removeFence("```waiting-on\nwhom: Alice\n```", "waiting-on")).toBeNull();
  });

  it("removes a leading fence and collapses the blank line", () => {
    const note = "```waiting-on\nwhom: Alice\n```\n\nuser content here";
    expect(removeFence(note, "waiting-on")).toBe("user content here");
  });

  it("removes a middle fence and joins surrounding text with a blank line", () => {
    const note = "before paragraph\n\n```waiting-on\nwhom: Alice\n```\n\nafter paragraph";
    expect(removeFence(note, "waiting-on")).toBe("before paragraph\n\nafter paragraph");
  });

  it("does not touch fences with different tags", () => {
    const note = "```other\nfoo: bar\n```\n\nuser text";
    expect(removeFence(note, "waiting-on")).toBe(note);
  });
});
