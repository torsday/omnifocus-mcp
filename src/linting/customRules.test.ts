import { describe, expect, it } from "vitest";
import { checkFileContent } from "./customRules.js";

describe("no-id-cast rule", () => {
  it("flags `as TaskId` in a regular source file", () => {
    const v = checkFileContent("src/services/taskService.ts", "const id = raw as TaskId;");
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-id-cast");
  });

  it("flags all branded ID types", () => {
    const ids = ["TaskId", "ProjectId", "TagId", "FolderId", "AttachmentId"];
    for (const id of ids) {
      const v = checkFileContent("src/foo.ts", `const x = raw as ${id};`);
      expect(v).toHaveLength(1);
      expect(v[0]?.rule).toBe("no-id-cast");
    }
  });

  it("does not flag `as TaskId` inside src/domain/ids.ts", () => {
    const v = checkFileContent("src/domain/ids.ts", "return raw as TaskId;");
    expect(v).toHaveLength(0);
  });

  it("does not flag unrelated `as` casts", () => {
    const v = checkFileContent("src/foo.ts", "const x = val as string;");
    expect(v).toHaveLength(0);
  });

  it("reports the correct line number", () => {
    const content = "const a = 1;\nconst b = raw as ProjectId;\nconst c = 3;";
    const v = checkFileContent("src/foo.ts", content);
    expect(v[0]?.line).toBe(2);
  });

  it("includes the trimmed line excerpt", () => {
    const content = "  const id = raw as FolderId;  ";
    const v = checkFileContent("src/foo.ts", content);
    expect(v[0]?.excerpt).toBe("const id = raw as FolderId;");
  });
});

describe("no-generic-error rule", () => {
  it("flags `throw new Error(` in a service file", () => {
    const v = checkFileContent("src/services/foo.ts", 'throw new Error("something went wrong");');
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-generic-error");
  });

  it("flags `throw new Error(` with varied whitespace", () => {
    const v = checkFileContent("src/foo.ts", 'throw  new   Error("msg");');
    expect(v).toHaveLength(1);
  });

  it("does not flag `throw new Error(` inside src/errors/", () => {
    const v = checkFileContent("src/errors/index.ts", 'throw new Error("base");');
    expect(v).toHaveLength(0);
  });

  it("does not flag typed subclass throws", () => {
    const v = checkFileContent("src/foo.ts", 'throw new ValidationError("bad input");');
    expect(v).toHaveLength(0);
  });

  it("does not flag class declarations containing Error in the name", () => {
    const v = checkFileContent("src/foo.ts", "class MyError extends Error {}");
    expect(v).toHaveLength(0);
  });

  it("reports the correct line number", () => {
    const content = 'const x = 1;\nthrow new Error("oops");\nconst y = 2;';
    const v = checkFileContent("src/foo.ts", content);
    expect(v[0]?.line).toBe(2);
  });
});

describe("comment and test exclusions", () => {
  it("skips // comment lines", () => {
    const v = checkFileContent("src/foo.ts", "// return val as TaskId;");
    expect(v).toHaveLength(0);
  });

  it("skips * JSDoc lines", () => {
    const v = checkFileContent("src/foo.ts", " * as TaskId cast used here");
    expect(v).toHaveLength(0);
  });

  it("skips test files entirely", () => {
    const v = checkFileContent("src/foo.test.ts", 'throw new Error("in test");');
    expect(v).toHaveLength(0);
  });
});

describe("multi-rule", () => {
  it("reports both violations in the same file", () => {
    const content = 'const id = x as TaskId;\nthrow new Error("bad");';
    const v = checkFileContent("src/foo.ts", content);
    expect(v).toHaveLength(2);
    expect(v.map((x) => x.rule)).toEqual(["no-id-cast", "no-generic-error"]);
  });
});
