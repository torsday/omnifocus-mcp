import { describe, expect, it } from "vitest";
import taskConvertToProjectScript from "./task_convert_to_project.js";

/**
 * Hermetic unit tests for the task_convert_to_project OmniJS script.
 *
 * Pins the folderId path: the folder lookup must use the global
 * `flattenedFolders` (the OmniJS `library` has no `.folders` property —
 * verified live), and the insertion location must be `folder.beginning` /
 * `folder.ending` (`folder.children` is a plain SectionArray with no
 * insertion locations; `folder.children.ending` lands the project at the
 * library root — see project_create.js's empirically verified note).
 */

/**
 * Evaluate an OmniJS script source with the given globals in scope.
 * `globalThis` is shadowed by a parameter so `globalThis.__args` resolves
 * to the supplied args without touching the real Node global.
 */
function runScript<T>(source: string, globals: Record<string, unknown>, args: unknown = {}): T {
  const names = Object.keys(globals);
  const values = names.map((n) => globals[n]);
  // biome-ignore lint/security/noGlobalEval: intentional — direct eval is the mechanism that runs the OmniJS script body against mocked globals without a live OmniFocus.
  const fn = new Function("globalThis", ...names, "__source", "return eval(__source);") as (
    ...fnArgs: unknown[]
  ) => string;
  return JSON.parse(fn({ __args: args }, ...values, source)) as T;
}

function buildEnv() {
  const task = { id: { primaryKey: "task-1" } };
  const folder = {
    id: { primaryKey: "folder-1" },
    // ChildInsertionLocation sentinels live on the folder itself.
    beginning: { __loc: "folder-beginning" },
    ending: { __loc: "folder-ending" },
    // `children` is a plain SectionArray in OmniJS — no beginning/ending.
    children: [],
  };
  const library = {
    beginning: { __loc: "library-beginning" },
    ending: { __loc: "library-ending" },
    // NOTE: no `folders` property — the real OmniJS library has none.
  };
  const calls: Array<{ tasks: unknown[]; pos: unknown }> = [];
  const convertTasksToProjects = (tasks: unknown[], pos: unknown) => {
    if (pos == null) {
      // Mirror live OF: a null/undefined position is rejected outright.
      throw new Error('argument "position" at index 1 requires a non-null value');
    }
    calls.push({ tasks, pos });
    return [{ id: { primaryKey: "proj-1" } }];
  };
  return {
    task,
    folder,
    calls,
    globals: {
      flattenedTasks: [task],
      flattenedFolders: [folder],
      library,
      convertTasksToProjects,
    },
  };
}

describe("task_convert_to_project.js", () => {
  it("converts into the requested folder via folder.ending", () => {
    const env = buildEnv();
    const result = runScript(taskConvertToProjectScript, env.globals, {
      id: "task-1",
      folderId: "folder-1",
    });
    expect(result).toEqual({ projectId: "proj-1" });
    expect(env.calls).toHaveLength(1);
    expect(env.calls[0]?.pos).toBe(env.folder.ending);
    expect(env.calls[0]?.tasks).toEqual([env.task]);
  });

  it('uses folder.beginning when position is "beginning"', () => {
    const env = buildEnv();
    runScript(taskConvertToProjectScript, env.globals, {
      id: "task-1",
      folderId: "folder-1",
      position: "beginning",
    });
    expect(env.calls[0]?.pos).toBe(env.folder.beginning);
  });

  it("returns NOT_FOUND for an unknown folderId", () => {
    const env = buildEnv();
    const result = runScript<{ error: { code: string } }>(taskConvertToProjectScript, env.globals, {
      id: "task-1",
      folderId: "no-such-folder",
    });
    expect(result.error.code).toBe("NOT_FOUND");
    expect(env.calls).toHaveLength(0);
  });

  it("defaults to library.ending when no folderId is given", () => {
    const env = buildEnv();
    const result = runScript(taskConvertToProjectScript, env.globals, { id: "task-1" });
    expect(result).toEqual({ projectId: "proj-1" });
    expect(env.calls[0]?.pos).toBe(env.globals.library.ending);
  });
});
