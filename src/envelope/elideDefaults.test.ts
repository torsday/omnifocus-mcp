/**
 * Tests for {@link elideDefaults} — default-valued field omission helper (#774).
 * Goldilocks coverage: per-field omission, equivalentTo, empty-array shorthand,
 * input not mutated, no-default fields preserved, type narrowing intent.
 */

import { describe, expect, it } from "vitest";
import { elideDefaults, elideDefaultsAll, type FieldDefaults } from "./elideDefaults.js";

interface Foo extends Record<string, unknown> {
  flagged: boolean;
  completed: boolean;
  tagIds: string[];
  note: string | null;
  name: string;
  count: number;
}

const FOO_DEFAULTS: FieldDefaults<Foo> = {
  flagged: { value: false },
  completed: { value: false },
  tagIds: { value: [] },
  note: { value: null, equivalentTo: [""] },
};

describe("elideDefaults", () => {
  it("omits keys at their default value", () => {
    const out = elideDefaults<Foo>(
      { flagged: false, completed: false, tagIds: [], note: null, name: "x", count: 7 },
      FOO_DEFAULTS,
    );
    expect(out).toEqual({ name: "x", count: 7 });
  });

  it("keeps keys whose value differs from the default", () => {
    const out = elideDefaults<Foo>(
      { flagged: true, completed: false, tagIds: ["a"], note: "hi", name: "x", count: 0 },
      FOO_DEFAULTS,
    );
    expect(out).toEqual({ flagged: true, tagIds: ["a"], note: "hi", name: "x", count: 0 });
  });

  it("treats equivalentTo values as default", () => {
    // note: "" is equivalent to default null
    const out = elideDefaults<Foo>(
      { flagged: false, completed: false, tagIds: [], note: "", name: "x", count: 0 },
      FOO_DEFAULTS,
    );
    expect(out).toEqual({ name: "x", count: 0 });
  });

  it("treats any empty array as default when spec.value is []", () => {
    const out = elideDefaults<Foo>(
      { flagged: false, completed: false, tagIds: [], note: "anything", name: "x", count: 0 },
      FOO_DEFAULTS,
    );
    expect(out.tagIds).toBeUndefined();
  });

  it("preserves non-empty arrays", () => {
    const out = elideDefaults<Foo>(
      {
        flagged: false,
        completed: false,
        tagIds: ["a", "b"],
        note: null,
        name: "x",
        count: 0,
      },
      FOO_DEFAULTS,
    );
    expect(out.tagIds).toEqual(["a", "b"]);
  });

  it("does not mutate the input", () => {
    const obj: Foo = {
      flagged: false,
      completed: true,
      tagIds: [],
      note: null,
      name: "x",
      count: 0,
    };
    const snapshot = JSON.stringify(obj);
    elideDefaults(obj, FOO_DEFAULTS);
    expect(JSON.stringify(obj)).toBe(snapshot);
  });

  it("preserves keys with no default spec", () => {
    // `name` and `count` have no spec — must always pass through
    const out = elideDefaults<Foo>(
      { flagged: false, completed: false, tagIds: [], note: null, name: "kept", count: 99 },
      FOO_DEFAULTS,
    );
    expect(out).toEqual({ name: "kept", count: 99 });
  });

  it("does not elide a non-default value that happens to be falsy (count: 0 with no spec)", () => {
    const out = elideDefaults<Foo>(
      { flagged: false, completed: false, tagIds: [], note: null, name: "", count: 0 },
      FOO_DEFAULTS,
    );
    // `name: ""` and `count: 0` have no specs → pass through verbatim
    expect(out).toEqual({ name: "", count: 0 });
  });
});

describe("elideDefaultsAll", () => {
  it("applies elision to every element", () => {
    const items: Foo[] = [
      { flagged: false, completed: false, tagIds: [], note: null, name: "a", count: 1 },
      { flagged: true, completed: false, tagIds: ["t1"], note: null, name: "b", count: 2 },
    ];
    const out = elideDefaultsAll(items, FOO_DEFAULTS);
    expect(out).toEqual([
      { name: "a", count: 1 },
      { flagged: true, tagIds: ["t1"], name: "b", count: 2 },
    ]);
  });

  it("returns a new array; does not mutate the input array or its elements", () => {
    const items: Foo[] = [
      { flagged: false, completed: false, tagIds: [], note: null, name: "a", count: 1 },
    ];
    const snapshot = JSON.stringify(items);
    const out = elideDefaultsAll(items, FOO_DEFAULTS);
    expect(JSON.stringify(items)).toBe(snapshot);
    expect(out).not.toBe(items);
  });
});
