import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_NOTE_PREVIEW_CHARS, NO_TRUNCATION } from "../tools/task/notePreview.js";
import { READ_DEFAULTS } from "./density.js";
import {
  getSessionDensity,
  getSessionReadDefaults,
  isDensity,
  negotiateDensityFromCapabilities,
  resetSessionState,
  resolveIncludeLinks,
  resolveIncludeSubtasks,
  resolveNotePreviewChars,
  setSessionDensity,
} from "./sessionState.js";

afterEach(() => {
  // Process singleton — reset so cases don't leak into each other or the
  // wider suite (which assumes the "default" baseline).
  resetSessionState();
});

describe("density profiles", () => {
  it("default and compact are the same lean shape (post-audit baseline)", () => {
    expect(READ_DEFAULTS.compact).toEqual(READ_DEFAULTS.default);
    expect(READ_DEFAULTS.default).toEqual({
      includeLinks: false,
      includeSubtasks: false,
      notePreviewChars: DEFAULT_NOTE_PREVIEW_CHARS,
    });
  });

  it("full opts into the rich shape with untruncated notes", () => {
    expect(READ_DEFAULTS.full).toEqual({
      includeLinks: true,
      includeSubtasks: true,
      notePreviewChars: NO_TRUNCATION,
    });
  });

  it("keeps the lean note-preview window in lockstep with DEFAULT_NOTE_PREVIEW_CHARS", () => {
    // Drift guard: density.ts hardcodes 200 to avoid a state→tools import.
    expect(READ_DEFAULTS.default.notePreviewChars).toBe(DEFAULT_NOTE_PREVIEW_CHARS);
  });
});

describe("isDensity", () => {
  it("accepts the three known values", () => {
    expect(isDensity("compact")).toBe(true);
    expect(isDensity("default")).toBe(true);
    expect(isDensity("full")).toBe(true);
  });

  it("rejects unknown strings and non-strings", () => {
    expect(isDensity("verbose")).toBe(false);
    expect(isDensity("")).toBe(false);
    expect(isDensity(undefined)).toBe(false);
    expect(isDensity(42)).toBe(false);
    expect(isDensity({ mode: "compact" })).toBe(false);
  });
});

describe("session density singleton", () => {
  it("defaults to 'default' so unsignaled clients see unchanged behavior", () => {
    expect(getSessionDensity()).toBe("default");
    expect(getSessionReadDefaults()).toEqual(READ_DEFAULTS.default);
  });

  it("reflects a set value", () => {
    setSessionDensity("full");
    expect(getSessionDensity()).toBe("full");
    expect(getSessionReadDefaults()).toEqual(READ_DEFAULTS.full);
  });
});

describe("negotiateDensityFromCapabilities", () => {
  it("adopts a valid density from experimental capabilities", () => {
    expect(negotiateDensityFromCapabilities({ density: "full" })).toBe("full");
    expect(getSessionDensity()).toBe("full");
  });

  it("falls back to 'default' for missing, unknown, or malformed signals", () => {
    expect(negotiateDensityFromCapabilities(undefined)).toBe("default");
    expect(negotiateDensityFromCapabilities({})).toBe("default");
    expect(negotiateDensityFromCapabilities({ density: "verbose" })).toBe("default");
    expect(negotiateDensityFromCapabilities({ density: { mode: "full" } })).toBe("default");
  });
});

describe("per-call override precedence", () => {
  it("an explicit argument always wins over the session default", () => {
    setSessionDensity("full");
    // Session says include; explicit false overrides.
    expect(resolveIncludeLinks(false)).toBe(false);
    expect(resolveIncludeSubtasks(false)).toBe(false);
    expect(resolveNotePreviewChars(50)).toBe(50);
  });

  it("undefined falls back to the session default", () => {
    setSessionDensity("full");
    expect(resolveIncludeLinks(undefined)).toBe(true);
    expect(resolveIncludeSubtasks(undefined)).toBe(true);
    expect(resolveNotePreviewChars(undefined)).toBe(NO_TRUNCATION);
  });

  it("under the default profile, omitted args resolve to the lean shape", () => {
    expect(resolveIncludeLinks(undefined)).toBe(false);
    expect(resolveIncludeSubtasks(undefined)).toBe(false);
    expect(resolveNotePreviewChars(undefined)).toBe(DEFAULT_NOTE_PREVIEW_CHARS);
  });
});
