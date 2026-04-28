/**
 * Unit tests for `validateRefined` — handler-boundary refinement guard.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ValidationError } from "./index.js";
import { validateRefined } from "./validateRefined.js";

const baseSchema = z.object({
  projectId: z.string().optional(),
  parentId: z.string().optional(),
});

const refined = baseSchema.refine((v) => !(v.projectId !== undefined && v.parentId !== undefined), {
  message: "Supply at most one of projectId or parentId",
  path: ["projectId"],
});

describe("validateRefined", () => {
  it("returns the parsed value when input passes the refinement", () => {
    const out = validateRefined(refined, { projectId: "p1" });
    expect(out).toEqual({ projectId: "p1" });
  });

  it("returns the parsed value when input is the empty branch", () => {
    expect(validateRefined(refined, {})).toEqual({});
  });

  it("throws ValidationError with details.failures on refinement violation", () => {
    let caught: unknown;
    try {
      validateRefined(refined, { projectId: "p1", parentId: "t1" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    if (!(caught instanceof ValidationError)) return;
    expect(caught.details).toBeDefined();
    const failures = (caught.details as { failures: Array<{ field: string; sent: unknown }> })
      .failures;
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]?.field).toBe("projectId");
  });

  it("uses the supplied error message when provided", () => {
    let caught: unknown;
    try {
      validateRefined(refined, { projectId: "p1", parentId: "t1" }, "Tool-specific frame");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    if (caught instanceof ValidationError) {
      expect(caught.message).toContain("Tool-specific frame");
    }
  });
});
