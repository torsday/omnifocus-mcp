import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  AttachmentId,
  FolderId,
  IdConstructors,
  OMNIFOCUS_ID_PATTERN,
  ProjectId,
  TagId,
  TaskId,
  isOmniFocusId,
} from "./ids.js";

describe("isOmniFocusId", () => {
  it("we accept plausible OmniFocus persistent IDs", () => {
    expect(isOmniFocusId("gHqVKr3xAWo")).toBe(true);
    expect(isOmniFocusId("pAbCdEfGhIj")).toBe(true);
    expect(isOmniFocusId("tag_with_underscores")).toBe(true);
    expect(isOmniFocusId("id-with-dashes")).toBe(true);
  });

  it("we reject everything that isn't a plausible ID", () => {
    expect(isOmniFocusId("")).toBe(false);
    expect(isOmniFocusId("ab")).toBe(false); // too short
    expect(isOmniFocusId("a".repeat(65))).toBe(false); // too long
    expect(isOmniFocusId("has spaces")).toBe(false);
    expect(isOmniFocusId("has/slashes")).toBe(false);
    expect(isOmniFocusId("has.dots")).toBe(false);
    expect(isOmniFocusId("emoji🎉here")).toBe(false);
    expect(isOmniFocusId(null)).toBe(false);
    expect(isOmniFocusId(undefined)).toBe(false);
    expect(isOmniFocusId(123)).toBe(false);
    expect(isOmniFocusId({})).toBe(false);
  });
});

describe("TaskId.of()", () => {
  it("we return the input unchanged at runtime for valid IDs", () => {
    const raw = "gHqVKr3xAWo";
    expect(TaskId.of(raw)).toBe(raw);
  });

  it("we throw a ZodError with a kind-specific message on invalid input", () => {
    expect(() => TaskId.of("")).toThrow(ZodError);
    try {
      TaskId.of("invalid id");
    } catch (e) {
      expect(e).toBeInstanceOf(ZodError);
      expect((e as ZodError).issues[0]?.message).toContain("TaskId");
    }
  });

  it("we expose a predicate that narrows unknown to the branded kind", () => {
    expect(TaskId.is("tAbCdEfGhIj")).toBe(true);
    expect(TaskId.is("bad!")).toBe(false);
    expect(TaskId.is(null)).toBe(false);
  });

  it("we expose a zod schema that parses strings into the branded type", () => {
    expect(TaskId.schema.safeParse("gHqVKr3xAWo").success).toBe(true);
    expect(TaskId.schema.safeParse("!!").success).toBe(false);
  });

  it("we expose the kind tag for debuggability", () => {
    expect(TaskId.kind).toBe("TaskId");
    expect(ProjectId.kind).toBe("ProjectId");
    expect(TagId.kind).toBe("TagId");
    expect(FolderId.kind).toBe("FolderId");
    expect(AttachmentId.kind).toBe("AttachmentId");
  });
});

describe("all five constructors", () => {
  it("we produce five independently-keyed constructors", () => {
    const kinds = Object.values(IdConstructors).map((c) => c.kind);
    expect(kinds).toEqual(["TaskId", "ProjectId", "TagId", "FolderId", "AttachmentId"]);
  });

  it("we apply the same shape check to every constructor", () => {
    const raw = "validId_123";
    for (const ctor of Object.values(IdConstructors)) {
      expect(ctor.of(raw)).toBe(raw);
      expect(ctor.is(raw)).toBe(true);
    }
  });

  it("we reject the same invalid shapes uniformly across constructors", () => {
    const invalids = ["", "a", "has space", "a".repeat(65)];
    for (const ctor of Object.values(IdConstructors)) {
      for (const bad of invalids) {
        expect(() => ctor.of(bad)).toThrow(ZodError);
      }
    }
  });
});

describe("TypeScript brand guarantees", () => {
  it("we produce distinct types for each kind", () => {
    // Runtime check is trivial; the real guarantee is compile-time.
    // Uncommenting the assignment below must fail tsc:
    //   const wrong: ReturnType<typeof TaskId.of> = TagId.of("tagAAAAA000");
    const task = TaskId.of("taskAAA000");
    const tag = TagId.of("tagAAAAA000");
    expect(task).toBe("taskAAA000");
    expect(tag).toBe("tagAAAAA000");
  });
});

describe("property — any string matching the pattern parses cleanly", () => {
  it("IdConstructors.of accepts every in-shape string", () => {
    fc.assert(
      fc.property(fc.stringMatching(OMNIFOCUS_ID_PATTERN), (raw) => {
        for (const ctor of Object.values(IdConstructors)) {
          expect(ctor.of(raw)).toBe(raw);
          expect(ctor.is(raw)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("property — strings with forbidden characters always reject", () => {
  it("IdConstructors.is returns false whenever the input contains an out-of-range character", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => /[^A-Za-z0-9_-]/.test(s)),
        (raw) => {
          expect(isOmniFocusId(raw)).toBe(false);
          for (const ctor of Object.values(IdConstructors)) {
            expect(ctor.is(raw)).toBe(false);
            expect(() => ctor.of(raw)).toThrow();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
