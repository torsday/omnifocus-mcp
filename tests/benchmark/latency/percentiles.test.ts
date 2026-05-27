import { describe, expect, test } from "vitest";
import { max, percentile } from "./percentiles.js";

describe("percentile", () => {
  test("empty input returns 0 (callers can rely on this without guarding)", () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([], 0.95)).toBe(0);
  });

  test("single sample returns that sample at any p", () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.95)).toBe(42);
  });

  test("p50 of [1..10] lands on the 5th element (nearest-rank)", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
  });

  test("p95 of [1..20] lands on the 19th element", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(xs, 0.95)).toBe(19);
  });

  test("input is not mutated", () => {
    const xs = [3, 1, 2];
    percentile(xs, 0.5);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("max", () => {
  test("empty input returns 0", () => {
    expect(max([])).toBe(0);
  });

  test("returns the largest sample", () => {
    expect(max([1, 5, 3, 2])).toBe(5);
    expect(max([42])).toBe(42);
  });
});
