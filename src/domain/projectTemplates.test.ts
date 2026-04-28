import { describe, expect, it } from "vitest";
import {
  buildProjectTemplateNote,
  PROJECT_TEMPLATE_FENCE,
  parseProjectTemplateMeta,
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
