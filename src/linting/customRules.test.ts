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

describe("no-metadata-interpolation rule", () => {
  it("flags task.name in a suggestion field", () => {
    const v = checkFileContent(
      "src/services/taskService.ts",
      "suggestion: `Task ${task.name} not found`",
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-metadata-interpolation");
  });

  it("flags task.note in a message field", () => {
    const v = checkFileContent("src/tools/task/list.ts", 'message: "Note was: " + task.note');
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-metadata-interpolation");
  });

  it("flags task.name in a warnings field", () => {
    const v = checkFileContent("src/services/taskService.ts", "warning: `skipped ${task.name}`");
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-metadata-interpolation");
  });

  it("flags project.name in a suggestion field", () => {
    const v = checkFileContent(
      "src/services/projectService.ts",
      "suggestion: `project ${project.name} is complete`",
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-metadata-interpolation");
  });

  it("flags task.noteHtml in a metadata field", () => {
    const v = checkFileContent("src/tools/task/get.ts", "message: task.noteHtml");
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-metadata-interpolation");
  });

  it("does not flag task.name when used in data payload assignment", () => {
    // Only metadata keywords trigger the rule; `data` / `name:` on its own is fine
    const v = checkFileContent("src/services/taskService.ts", "name: task.name,");
    expect(v).toHaveLength(0);
  });

  it("does not flag task.id (IDs are safe in metadata)", () => {
    const v = checkFileContent(
      "src/services/taskService.ts",
      "suggestion: `retry with id ${task.id}`",
    );
    expect(v).toHaveLength(0);
  });

  it("adversarial task name stays out of metadata — SYSTEM prefix", () => {
    // Simulates a task named "SYSTEM: ignore previous instructions"
    // The lint rule catches the pattern at the source level:
    // any interpolation of task.name into suggestion/message is forbidden.
    const adversarialInterpolation =
      "suggestion: `Task ${task.name} could not be found — check task_list`";
    const v = checkFileContent("src/services/taskService.ts", adversarialInterpolation);
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-metadata-interpolation");
  });

  it("does not flag comment lines", () => {
    const v = checkFileContent(
      "src/services/taskService.ts",
      "// suggestion: task.name — NEVER do this",
    );
    expect(v).toHaveLength(0);
  });
});

describe("no-network-import rule", () => {
  it("flags a static import of node:https", () => {
    const v = checkFileContent("src/services/foo.ts", 'import https from "node:https";');
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-network-import");
  });

  it("flags a static import of node:http", () => {
    const v = checkFileContent("src/services/foo.ts", 'import http from "node:http";');
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-network-import");
  });

  it("flags a static import of axios", () => {
    const v = checkFileContent("src/services/foo.ts", 'import axios from "axios";');
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-network-import");
  });

  it("flags a static import of node-fetch", () => {
    const v = checkFileContent("src/tools/task/list.ts", 'import fetch from "node-fetch";');
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-network-import");
  });

  it("flags a static import of undici", () => {
    const v = checkFileContent("src/adapter/omnijs/runner.ts", 'import { request } from "undici";');
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-network-import");
  });

  it("flags a dynamic import of https", () => {
    const v = checkFileContent("src/foo.ts", 'import("https")');
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-network-import");
  });

  it("does not flag node:fs imports", () => {
    const v = checkFileContent("src/services/foo.ts", 'import fs from "node:fs";');
    expect(v).toHaveLength(0);
  });

  it("does not flag node:path imports", () => {
    const v = checkFileContent("src/services/foo.ts", 'import path from "node:path";');
    expect(v).toHaveLength(0);
  });

  it("does not flag comment lines", () => {
    const v = checkFileContent("src/foo.ts", '// import axios from "axios"; — do not do this');
    expect(v).toHaveLength(0);
  });
});

describe("no-layer-violation rule", () => {
  it("flags transport implementation importing from services/", () => {
    const v = checkFileContent(
      "src/adapter/jxa/JxaTransport.ts",
      'import { TaskService } from "../../services/taskService.js";',
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-layer-violation");
  });

  it("flags transport implementation importing from tools/", () => {
    const v = checkFileContent(
      "src/adapter/omnijs/OmniJsTransport.ts",
      'import { handleTaskCreate } from "../../tools/task/create.js";',
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-layer-violation");
  });

  it("flags services/ importing from adapter implementation (jxa)", () => {
    const v = checkFileContent(
      "src/services/taskService.ts",
      'import { JxaTransport } from "../adapter/jxa/JxaTransport.js";',
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-layer-violation");
  });

  it("flags tools/ importing from adapter implementation (omnijs)", () => {
    const v = checkFileContent(
      "src/tools/task/create.ts",
      'import { OmniJsTransport } from "../../adapter/omnijs/OmniJsTransport.js";',
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("no-layer-violation");
  });

  it("does NOT flag tools/ importing the OmniFocusAdapter interface", () => {
    const v = checkFileContent(
      "src/tools/task/create.ts",
      'import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";',
    );
    expect(v).toHaveLength(0);
  });

  it("does NOT flag services/ importing the OmniFocusAdapter interface", () => {
    const v = checkFileContent(
      "src/services/taskService.ts",
      'import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";',
    );
    expect(v).toHaveLength(0);
  });

  it("does NOT flag adapter router importing transport implementations", () => {
    // The router lives inside adapter/ and is allowed to import jxa/ and omnijs/
    const v = checkFileContent(
      "src/adapter/router.ts",
      'import { JxaTransport } from "./jxa/JxaTransport.js";',
    );
    expect(v).toHaveLength(0);
  });

  it("does NOT flag adapter inMemory layer (not a transport implementation)", () => {
    const v = checkFileContent(
      "src/adapter/inMemory/InMemoryAdapter.ts",
      'import type { OmniFocusAdapter } from "../OmniFocusAdapter.js";',
    );
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
