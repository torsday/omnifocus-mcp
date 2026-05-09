/**
 * Unit tests for the field-projection helpers (#773).
 */

import { describe, expect, test } from "vitest";
import { applyProjection, applyProjectionMany, validateFields } from "./projection.js";

describe("validateFields", () => {
  const allowed = new Set(["name", "note", "flagged"]);

  test("partitions requested names into valid + unknown", () => {
    const result = validateFields(["name", "note", "bogus", "alsoBad"], allowed);
    expect(result.valid).toEqual(["name", "note"]);
    expect(result.unknown).toEqual(["bogus", "alsoBad"]);
  });

  test("strips `id` silently — it's always retained by the projection", () => {
    const result = validateFields(["id", "name"], allowed);
    expect(result.valid).toEqual(["name"]);
    expect(result.unknown).toEqual([]);
  });

  test("deduplicates repeated names", () => {
    const result = validateFields(["name", "name", "note", "note"], allowed);
    expect(result.valid).toEqual(["name", "note"]);
  });

  test("returns empty arrays for an empty request", () => {
    const result = validateFields([], allowed);
    expect(result.valid).toEqual([]);
    expect(result.unknown).toEqual([]);
  });
});

describe("applyProjection", () => {
  const sample = { id: "t1", name: "x", note: "n", flagged: true, dueDate: "2026-05-09" };

  test("returns the record unchanged when fields is undefined", () => {
    expect(applyProjection(sample, undefined)).toBe(sample);
  });

  test("retains `id` even when not listed in fields", () => {
    const result = applyProjection(sample, ["name"]);
    expect(result).toEqual({ id: "t1", name: "x" });
  });

  test("listing `id` explicitly is a no-op (already implicit)", () => {
    const result = applyProjection(sample, ["id", "name"]);
    expect(result).toEqual({ id: "t1", name: "x" });
  });

  test("with empty fields[] returns just `id` (the implicit minimum)", () => {
    const result = applyProjection(sample, []);
    expect(result).toEqual({ id: "t1" });
  });

  test("only includes fields the source actually has — silently skips missing", () => {
    const result = applyProjection(sample, ["name", "phantom"]);
    expect(result).toEqual({ id: "t1", name: "x" });
    expect(result).not.toHaveProperty("phantom");
  });

  test("preserves nullable values without dropping them", () => {
    const taskWithNullDue = { id: "t1", name: "x", dueDate: null };
    const result = applyProjection(taskWithNullDue, ["dueDate"]);
    expect(result).toEqual({ id: "t1", dueDate: null });
  });
});

describe("applyProjectionMany", () => {
  const records = [
    { id: "t1", name: "a", flagged: true },
    { id: "t2", name: "b", flagged: false },
  ];

  test("returns a shallow copy of the array when fields is undefined", () => {
    const result = applyProjectionMany(records, undefined);
    expect(result).toEqual(records);
    expect(result).not.toBe(records);
  });

  test("projects each record", () => {
    const result = applyProjectionMany(records, ["name"]);
    expect(result).toEqual([
      { id: "t1", name: "a" },
      { id: "t2", name: "b" },
    ]);
  });
});
