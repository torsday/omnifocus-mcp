import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToActionable } from "./zodToActionable.js";

/**
 * Each test pairs a schema with a deliberately-bad input, then asserts on
 * the `ActionableValidation[]` output. The schema is the contract under
 * test; never call private helpers directly — Zod 4's issue shapes are
 * what we're translating, and the surface we care about is what handlers
 * will pass in.
 */
function fail<T>(schema: z.ZodType<T>, input: unknown) {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected schema to reject input");
  return zodToActionable(result.error, input);
}

describe("zodToActionable — primitive type errors", () => {
  it("we map invalid_type with a one-sentence expected", () => {
    const schema = z.object({ count: z.number() });
    const out = fail(schema, { count: "three" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      field: "count",
      sent: "three",
      expected: "number",
    });
  });

  it("we report the missing field as undefined sent", () => {
    const schema = z.object({ count: z.number() });
    const out = fail(schema, {});
    expect(out[0]).toMatchObject({
      field: "count",
      sent: undefined,
      expected: "number",
    });
  });

  it("we keep the path in dotted/bracketed form", () => {
    const schema = z.object({
      project: z.object({ tags: z.array(z.object({ name: z.string() })) }),
    });
    const out = fail(schema, { project: { tags: [{ name: "ok" }, { name: 42 }] } });
    expect(out[0]?.field).toBe("project.tags[1].name");
  });
});

describe("zodToActionable — enums and literals", () => {
  it("we list enum choices and surface the first three as examples", () => {
    const schema = z.object({ priority: z.enum(["P0", "P1", "P2", "P3"]) });
    const out = fail(schema, { priority: "urgent" });
    expect(out[0]?.field).toBe("priority");
    expect(out[0]?.sent).toBe("urgent");
    expect(out[0]?.expected).toContain('"P0"');
    expect(out[0]?.expected).toContain('"P3"');
    expect(out[0]?.examples).toEqual(["P0", "P1", "P2"]);
  });

  it("we trim very long enum lists in the expected text", () => {
    const big = Array.from({ length: 12 }, (_, i) => `v${i}`) as [string, ...string[]];
    const schema = z.object({ k: z.enum(big) });
    const out = fail(schema, { k: "missing" });
    expect(out[0]?.expected).toContain("more)");
    expect(out[0]?.expected).not.toContain('"v11"');
  });
});

describe("zodToActionable — string format errors", () => {
  it("we translate datetime to actionable ISO-8601 examples", () => {
    const schema = z.object({ due: z.string().datetime({ offset: true }) });
    const out = fail(schema, { due: "next tuesday" });
    expect(out[0]?.field).toBe("due");
    expect(out[0]?.sent).toBe("next tuesday");
    expect(out[0]?.expected).toMatch(/ISO-8601 datetime/);
    expect(out[0]?.examples?.[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("we translate email format with a usable example", () => {
    const schema = z.object({ contact: z.string().email() });
    const out = fail(schema, { contact: "not-email" });
    expect(out[0]?.expected).toBe("email address");
    expect(out[0]?.examples).toEqual(["user@example.com"]);
  });

  it("we fall back gracefully on unknown formats", () => {
    // A custom check with a format we don't have a mapping for.
    const schema = z.object({ slug: z.string().regex(/^[a-z]+$/) });
    const out = fail(schema, { slug: "Has-Caps" });
    expect(out[0]?.expected).toMatch(/regex|format/);
  });
});

describe("zodToActionable — bounds", () => {
  it("we describe array max with item-pluralized text", () => {
    const schema = z.object({ tags: z.array(z.string()).max(5) });
    const out = fail(schema, { tags: ["a", "b", "c", "d", "e", "f"] });
    expect(out[0]?.expected).toMatch(/array/);
    expect(out[0]?.expected).toMatch(/≤ 5/);
  });

  it("we describe number min", () => {
    const schema = z.object({ count: z.number().min(1) });
    const out = fail(schema, { count: 0 });
    expect(out[0]?.expected).toMatch(/≥ 1/);
  });

  it("we describe string min with character pluralization", () => {
    const schema = z.object({ name: z.string().min(1) });
    const out = fail(schema, { name: "" });
    expect(out[0]?.expected).toBe("string with ≥ 1 character");
  });

  it("we keep singular vs plural readable", () => {
    const schema = z.object({ items: z.array(z.string()).min(1) });
    const out = fail(schema, { items: [] });
    expect(out[0]?.expected).toBe("array with ≥ 1 item");
  });
});

describe("zodToActionable — unrecognized keys", () => {
  it("we emit one row per stray key so the agent can drop each individually", () => {
    const schema = z.strictObject({ id: z.string() });
    const out = fail(schema, { id: "abc", extra1: 1, extra2: 2 });
    expect(out).toHaveLength(2);
    const fields = out.map((r) => r.field).sort();
    expect(fields).toEqual(["extra1", "extra2"]);
    for (const r of out) {
      expect(r.expected).toMatch(/not part of the schema/);
    }
  });

  it("we keep the parent path on nested unrecognized keys", () => {
    const schema = z.object({ project: z.strictObject({ name: z.string() }) });
    const out = fail(schema, { project: { name: "p", extra: 1 } });
    expect(out[0]?.field).toBe("project.extra");
    expect(out[0]?.sent).toBe(1);
  });
});

describe("zodToActionable — input plucking", () => {
  it("we set sent=undefined when no input is provided", () => {
    const schema = z.object({ count: z.number() });
    const result = schema.safeParse({ count: "x" });
    if (result.success) throw new Error("expected failure");
    const out = zodToActionable(result.error);
    expect(out[0]?.sent).toBeUndefined();
  });

  it("we tolerate missing intermediate parents on deep paths", () => {
    // The schema asks for project.tags but the input has no .project at all.
    const schema = z.object({
      project: z.object({ tags: z.array(z.string()) }),
    });
    const out = fail(schema, {});
    expect(out[0]?.sent).toBeUndefined();
    expect(out[0]?.field).toBe("project");
  });
});

describe("zodToActionable — multi-issue inputs", () => {
  it("we return one row per Zod issue, preserving order", () => {
    const schema = z.object({
      priority: z.enum(["P0", "P1"]),
      count: z.number(),
      tags: z.array(z.string()).max(2),
    });
    const out = fail(schema, {
      priority: "urgent",
      count: "three",
      tags: ["a", "b", "c"],
    });
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.field)).toEqual(["priority", "count", "tags"]);
  });

  it("we degenerate to an empty array on a ZodError with no issues", () => {
    // Construct a synthetic empty ZodError. Zod won't normally produce one,
    // but the helper must not crash if it ever sees one.
    const schema = z.object({ a: z.string() });
    const result = schema.safeParse({ a: "ok" });
    if (!result.success) throw new Error("expected success in this fixture");
    // Build a fresh ZodError with no issues using the public constructor.
    const zerr = new z.ZodError([]);
    expect(zodToActionable(zerr)).toEqual([]);
  });
});

describe("zodToActionable — output integrates with ValidationError", () => {
  it("the failures array round-trips through JSON.stringify untouched", () => {
    const schema = z.object({ name: z.string().min(1) });
    const out = fail(schema, { name: "" });
    const json = JSON.parse(JSON.stringify(out)) as typeof out;
    expect(json[0]?.field).toBe("name");
    expect(json[0]?.expected).toMatch(/character/);
  });
});
