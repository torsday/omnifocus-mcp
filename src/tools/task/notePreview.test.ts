/**
 * Unit tests for the note-preview helper (#775).
 */

import { describe, expect, test } from "vitest";
import { applyNotePreview, DEFAULT_NOTE_PREVIEW_CHARS, NO_TRUNCATION } from "./notePreview.js";

describe("applyNotePreview", () => {
  test("passes through when note is null", () => {
    const task = { id: "t1", name: "x", note: null };
    expect(applyNotePreview(task, 50)).toBe(task);
  });

  test("passes through when note is shorter than the cap", () => {
    const task = { id: "t1", name: "x", note: "short" };
    expect(applyNotePreview(task, 50)).toBe(task);
  });

  test("passes through at exact-equal length boundary", () => {
    const task = { id: "t1", name: "x", note: "abcde" };
    expect(applyNotePreview(task, 5)).toBe(task);
  });

  test("truncates and emits the triplet when note exceeds the cap", () => {
    const long = "a".repeat(500);
    const task = { id: "t1", name: "x", note: long, flagged: false };
    const result = applyNotePreview(task, 200);

    expect(result).not.toBe(task);
    expect(result).toEqual({
      id: "t1",
      name: "x",
      flagged: false,
      notePreview: "a".repeat(200),
      noteTruncated: true,
      noteLength: 500,
    });
    expect(result).not.toHaveProperty("note");
  });

  test("noteLength reports UTF-8 byte length, not codepoint count", () => {
    // "🌲" is U+1F332 — 4 UTF-8 bytes, 1 codepoint, 2 UTF-16 code units.
    const note = "🌲".repeat(50); // 50 codepoints, 200 UTF-8 bytes
    const task = { id: "t1", note };
    const result = applyNotePreview(task, 10);

    if (!("noteTruncated" in result)) throw new Error("expected truncation");
    expect(result.notePreview).toBe("🌲".repeat(10));
    expect(result.noteLength).toBe(200);
  });

  test("truncates at codepoint boundary, not UTF-16 code unit", () => {
    // A run of supplementary-plane codepoints. Naively slicing the JS string
    // by .length would split a surrogate pair at an odd index; iterating by
    // codepoint never does.
    const note = "🌲🌳🌴🌵🌶".repeat(20); // 100 codepoints
    const task = { id: "t1", note };
    const result = applyNotePreview(task, 7);

    if (!("noteTruncated" in result)) throw new Error("expected truncation");
    expect(Array.from(result.notePreview)).toHaveLength(7);
    expect(result.notePreview).toBe("🌲🌳🌴🌵🌶🌲🌳");
  });

  test("opts out when notePreviewChars is negative (NO_TRUNCATION)", () => {
    const long = "a".repeat(5000);
    const task = { id: "t1", note: long };
    expect(applyNotePreview(task, NO_TRUNCATION)).toBe(task);
  });

  test("zero cap yields an empty preview when the note is non-empty", () => {
    const task = { id: "t1", note: "anything" };
    const result = applyNotePreview(task, 0);

    if (!("noteTruncated" in result)) throw new Error("expected truncation");
    expect(result.notePreview).toBe("");
    expect(result.noteTruncated).toBe(true);
    expect(result.noteLength).toBe(8);
  });

  test("DEFAULT_NOTE_PREVIEW_CHARS is 200", () => {
    expect(DEFAULT_NOTE_PREVIEW_CHARS).toBe(200);
  });
});
