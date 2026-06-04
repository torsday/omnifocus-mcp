import { describe, expect, it } from "vitest";
import { deepEqual, diffRecord } from "./diff.js";

describe("deepEqual", () => {
  it("compares scalars", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual("a", "b")).toBe(false);
  });

  it("compares arrays element-wise (order-sensitive)", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual(["t1", "t2"], ["t1", "t2"])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it("compares nested objects structurally", () => {
    expect(deepEqual({ unit: "week", steps: 1 }, { unit: "week", steps: 1 })).toBe(true);
    expect(deepEqual({ unit: "week", steps: 1 }, { unit: "week", steps: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("distinguishes arrays from objects", () => {
    expect(deepEqual([], {})).toBe(false);
  });
});

describe("diffRecord", () => {
  it("returns only changed fields", () => {
    const prior = { id: "t1", name: "old", flagged: false, tagIds: ["a"] };
    const current = { id: "t1", name: "new", flagged: false, tagIds: ["a"] };
    expect(diffRecord(prior, current)).toEqual({ name: "new" });
  });

  it("returns empty when nothing changed", () => {
    const rec = { id: "t1", name: "x", tagIds: ["a", "b"] };
    expect(diffRecord(rec, { ...rec })).toEqual({});
  });

  it("detects array and nested-object changes", () => {
    const prior = { tagIds: ["a"], repetition: { unit: "week", steps: 1 } };
    const current = { tagIds: ["a", "b"], repetition: { unit: "week", steps: 2 } };
    expect(diffRecord(prior, current)).toEqual({
      tagIds: ["a", "b"],
      repetition: { unit: "week", steps: 2 },
    });
  });

  it("reports a cleared field as undefined", () => {
    const prior = { id: "t1", note: "hello" };
    const current = { id: "t1" };
    expect(diffRecord(prior, current)).toEqual({ note: undefined });
  });

  it("reports a newly added field", () => {
    const prior = { id: "t1" };
    const current = { id: "t1", dueDate: "2026-06-03" };
    expect(diffRecord(prior, current)).toEqual({ dueDate: "2026-06-03" });
  });
});
