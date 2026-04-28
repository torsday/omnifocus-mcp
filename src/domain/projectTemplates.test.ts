import { describe, expect, it } from "vitest";
import {
  buildProjectTemplateNote,
  extractProjectTemplateBody,
  findTemplateAnchorDate,
  PROJECT_TEMPLATE_FENCE,
  parseProjectTemplateMeta,
  shiftTemplateDates,
  substituteTemplateParameters,
} from "./projectTemplates.js";

describe("PROJECT_TEMPLATE_FENCE", () => {
  it("is the wire-stable fence tag", () => {
    expect(PROJECT_TEMPLATE_FENCE).toBe("project-template");
  });
});

describe("parseProjectTemplateMeta", () => {
  it("returns undefined for null or empty notes", () => {
    expect(parseProjectTemplateMeta(null)).toBeUndefined();
    expect(parseProjectTemplateMeta("")).toBeUndefined();
  });

  it("returns undefined when no template fence is present", () => {
    expect(parseProjectTemplateMeta("just some prose")).toBeUndefined();
    expect(parseProjectTemplateMeta("```other\nfoo: bar\n```")).toBeUndefined();
  });

  it("parses a complete fence", () => {
    const note =
      "```project-template\nname: Client onboarding\nparameters: client,startDate\ncapturedAt: 2026-04-27T20:00:00Z\n```";
    expect(parseProjectTemplateMeta(note)).toEqual({
      name: "Client onboarding",
      parameterNames: ["client", "startDate"],
      capturedAt: "2026-04-27T20:00:00Z",
    });
  });

  it("treats absent `parameters` as an empty list", () => {
    const note = "```project-template\nname: Quick capture\ncapturedAt: 2026-04-27T20:00:00Z\n```";
    expect(parseProjectTemplateMeta(note)).toEqual({
      name: "Quick capture",
      parameterNames: [],
      capturedAt: "2026-04-27T20:00:00Z",
    });
  });

  it("treats empty `parameters: ` as an empty list", () => {
    const note =
      "```project-template\nname: Quick capture\nparameters: \ncapturedAt: 2026-04-27T20:00:00Z\n```";
    expect(parseProjectTemplateMeta(note)?.parameterNames).toEqual([]);
  });

  it("trims whitespace inside the parameter list", () => {
    const note =
      "```project-template\nname: T\nparameters: a , b ,c\ncapturedAt: 2026-04-27T20:00:00Z\n```";
    expect(parseProjectTemplateMeta(note)?.parameterNames).toEqual(["a", "b", "c"]);
  });

  it("degrades to undefined when name is missing", () => {
    const note = "```project-template\ncapturedAt: 2026-04-27T20:00:00Z\n```";
    expect(parseProjectTemplateMeta(note)).toBeUndefined();
  });

  it("degrades to undefined when capturedAt is malformed", () => {
    const note = "```project-template\nname: T\ncapturedAt: yesterday\n```";
    expect(parseProjectTemplateMeta(note)).toBeUndefined();
  });

  it("ignores user prose below the fence", () => {
    const note =
      "```project-template\nname: T\ncapturedAt: 2026-04-27T20:00:00Z\n```\n\nT:\n\t- Step one";
    expect(parseProjectTemplateMeta(note)?.name).toBe("T");
  });
});

describe("buildProjectTemplateNote", () => {
  it("emits stable field order: name, parameters, capturedAt", () => {
    const out = buildProjectTemplateNote(
      {
        name: "Client onboarding",
        parameterNames: ["client", "startDate"],
        capturedAt: "2026-04-27T20:00:00Z",
      },
      "Client onboarding:\n\t- Send welcome email",
    );
    const fenceLines = out.split("\n").slice(1, 4);
    expect(fenceLines).toEqual([
      "name: Client onboarding",
      "parameters: client,startDate",
      "capturedAt: 2026-04-27T20:00:00Z",
    ]);
  });

  it("omits the parameters key when no parameters were captured", () => {
    const out = buildProjectTemplateNote(
      { name: "Quick capture", parameterNames: [], capturedAt: "2026-04-27T20:00:00Z" },
      "body",
    );
    expect(out).not.toContain("parameters:");
  });

  it("appends the TaskPaper body with a blank-line separator", () => {
    const out = buildProjectTemplateNote(
      { name: "T", parameterNames: [], capturedAt: "2026-04-27T20:00:00Z" },
      "T:\n\t- one",
    );
    expect(out).toBe(
      "```project-template\nname: T\ncapturedAt: 2026-04-27T20:00:00Z\n```\n\nT:\n\t- one",
    );
  });

  it("emits only the fence when the TaskPaper body is empty", () => {
    const out = buildProjectTemplateNote(
      { name: "T", parameterNames: [], capturedAt: "2026-04-27T20:00:00Z" },
      "",
    );
    expect(out).toBe("```project-template\nname: T\ncapturedAt: 2026-04-27T20:00:00Z\n```");
  });

  it("round-trips through parseProjectTemplateMeta", () => {
    const meta = {
      name: "Client onboarding",
      parameterNames: ["client", "startDate"],
      capturedAt: "2026-04-27T20:00:00Z",
    };
    const note = buildProjectTemplateNote(meta, "TaskPaper body here");
    expect(parseProjectTemplateMeta(note)).toEqual(meta);
  });
});

describe("extractProjectTemplateBody", () => {
  it("returns the empty string for null, empty, or fence-less notes", () => {
    expect(extractProjectTemplateBody(null)).toBe("");
    expect(extractProjectTemplateBody("")).toBe("");
    expect(extractProjectTemplateBody("just user prose")).toBe("");
  });

  it("returns the empty string when only the fence is present", () => {
    const note = buildProjectTemplateNote(
      { name: "T", parameterNames: [], capturedAt: "2026-04-27T20:00:00Z" },
      "",
    );
    expect(extractProjectTemplateBody(note)).toBe("");
  });

  it("returns the TaskPaper body verbatim", () => {
    const body = "T:\n\t- one\n\t- two @flagged";
    const note = buildProjectTemplateNote(
      { name: "T", parameterNames: [], capturedAt: "2026-04-27T20:00:00Z" },
      body,
    );
    expect(extractProjectTemplateBody(note)).toBe(body);
  });

  it("trims leading blank lines between fence and body", () => {
    const note =
      "```project-template\nname: T\ncapturedAt: 2026-04-27T20:00:00Z\n```\n\n\n\nT:\n\t- step";
    expect(extractProjectTemplateBody(note)).toBe("T:\n\t- step");
  });
});

describe("substituteTemplateParameters", () => {
  it("returns the body unchanged when no placeholders are present", () => {
    expect(substituteTemplateParameters("plain body", { x: "y" })).toBe("plain body");
  });

  it("substitutes a single placeholder", () => {
    expect(substituteTemplateParameters("Hi {{name}}", { name: "Alice" })).toBe("Hi Alice");
  });

  it("substitutes multiple placeholders, repeated occurrences included", () => {
    expect(substituteTemplateParameters("{{a}} and {{b}} and {{a}}", { a: "1", b: "2" })).toBe(
      "1 and 2 and 1",
    );
  });

  it("tolerates whitespace inside the braces", () => {
    expect(substituteTemplateParameters("{{ name }} / {{name}}", { name: "Alice" })).toBe(
      "Alice / Alice",
    );
  });

  it("leaves unknown placeholders untouched (visible failure, not silent loss)", () => {
    expect(substituteTemplateParameters("{{a}} {{b}}", { a: "1" })).toBe("1 {{b}}");
  });

  it("permits hyphen and underscore in parameter names", () => {
    expect(
      substituteTemplateParameters("{{client_name}} / {{start-date}}", {
        client_name: "Acme",
        "start-date": "2026-05-01",
      }),
    ).toBe("Acme / 2026-05-01");
  });

  it("does not match single-brace patterns", () => {
    expect(substituteTemplateParameters("{name}", { name: "Alice" })).toBe("{name}");
  });
});

describe("findTemplateAnchorDate", () => {
  it("returns undefined when no @due date is present", () => {
    expect(findTemplateAnchorDate("T:\n\t- step @flagged")).toBeUndefined();
    expect(findTemplateAnchorDate("")).toBeUndefined();
  });

  it("returns the only @due date when there's exactly one", () => {
    expect(findTemplateAnchorDate("T:\n\t- step @due(2026-05-04)")).toBe("2026-05-04");
  });

  it("returns the earliest @due date when multiple are present", () => {
    const body = "T:\n\t- a @due(2026-05-10)\n\t- b @due(2026-05-04)\n\t- c @due(2026-06-01)";
    expect(findTemplateAnchorDate(body)).toBe("2026-05-04");
  });

  it("ignores @defer dates when picking the anchor", () => {
    const body = "T:\n\t- a @defer(2026-04-01) @due(2026-05-10)\n\t- b @due(2026-05-04)";
    expect(findTemplateAnchorDate(body)).toBe("2026-05-04");
  });
});

describe("shiftTemplateDates", () => {
  it("returns the body unchanged when delta is zero", () => {
    const body = "T:\n\t- a @due(2026-05-04)";
    expect(shiftTemplateDates(body, "2026-05-04", "2026-05-04")).toBe(body);
  });

  it("shifts a single @due date forward", () => {
    expect(shiftTemplateDates("T:\n\t- a @due(2026-05-04)", "2026-05-04", "2026-06-04")).toBe(
      "T:\n\t- a @due(2026-06-04)",
    );
  });

  it("shifts both @due and @defer dates by the same delta", () => {
    // Delta = 31 days (2026-05-04 → 2026-06-04, May has 31 days).
    const body = "T:\n\t- a @defer(2026-04-29) @due(2026-05-04)";
    const out = shiftTemplateDates(body, "2026-05-04", "2026-06-04");
    expect(out).toBe("T:\n\t- a @defer(2026-05-30) @due(2026-06-04)");
  });

  it("preserves the relative spacing between every pair of dates", () => {
    const body = "T:\n\t- a @due(2026-05-04)\n\t- b @due(2026-05-11)";
    const out = shiftTemplateDates(body, "2026-05-04", "2026-06-04");
    // The 7-day gap is preserved.
    expect(out).toBe("T:\n\t- a @due(2026-06-04)\n\t- b @due(2026-06-11)");
  });

  it("supports a backward shift (newAnchor before anchor)", () => {
    expect(shiftTemplateDates("T:\n\t- a @due(2026-05-04)", "2026-05-04", "2026-04-04")).toBe(
      "T:\n\t- a @due(2026-04-04)",
    );
  });

  it("handles month and year boundaries via UTC math", () => {
    expect(shiftTemplateDates("T:\n\t- a @due(2026-12-31)", "2026-12-31", "2027-01-01")).toBe(
      "T:\n\t- a @due(2027-01-01)",
    );
  });
});
