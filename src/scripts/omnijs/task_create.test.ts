import { describe, expect, it } from "vitest";
import taskCreateScript from "./task_create.js";

/**
 * Hermetic unit tests for the task_create OmniJS script.
 *
 * Pins the completedByChildren write: OmniJS Task exposes
 * `completedByChildren` directly — `containsSingletonActions` is a
 * JXA-bridge-only runtime extra that does not exist on Task in OmniJS
 * (verified live), so writing it was a silent expando that dropped the
 * requested behavior while the script's own read-back echoed it.
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

interface FakeTask {
  id: { primaryKey: string };
  name: string;
  completedByChildren: boolean;
  [key: string]: unknown;
}

function buildEnv() {
  const created: FakeTask[] = [];
  // Mirrors the OmniJS Task surface task_create.js reads after construction.
  function Task(this: FakeTask, name: string, _position: unknown) {
    this.id = { primaryKey: "task-1" };
    this.name = name;
    this.note = "";
    this.flagged = false;
    this.deferDate = null;
    this.dueDate = null;
    this.estimatedMinutes = null;
    this.sequential = false;
    this.completedByChildren = false;
    this.completed = false;
    this.completionDate = null;
    this.dropped = false;
    this.dropDate = null;
    this.taskStatus = "available";
    this.containingProject = null;
    this.parent = null;
    this.tags = [];
    this.repetitionRule = null;
    this.added = new Date("2026-01-01T00:00:00Z");
    this.modified = new Date("2026-01-01T00:00:00Z");
    this.addTag = () => undefined;
    created.push(this);
  }
  Task.Status = { Available: "available", Blocked: "blocked" };
  return {
    created,
    globals: {
      Task,
      inbox: { ending: { __loc: "inbox-ending" } },
      flattenedTasks: [],
      flattenedProjects: [],
      flattenedTags: [],
    },
  };
}

describe("task_create.js — completedByChildren", () => {
  it("writes the real OmniJS completedByChildren property", () => {
    const env = buildEnv();
    const result = runScript<{ task: { completedByChildren: boolean } }>(
      taskCreateScript,
      env.globals,
      { name: "Pack bags", completedByChildren: true },
    );
    const task = env.created[0];
    expect(task?.completedByChildren).toBe(true);
    // No stray JXA-only expando on the OmniJS task.
    expect(task && "containsSingletonActions" in task).toBe(false);
    expect(result.task.completedByChildren).toBe(true);
  });

  it("leaves completedByChildren untouched when not requested", () => {
    const env = buildEnv();
    const result = runScript<{ task: { completedByChildren: boolean } }>(
      taskCreateScript,
      env.globals,
      { name: "Pack bags" },
    );
    expect(env.created[0]?.completedByChildren).toBe(false);
    expect(result.task.completedByChildren).toBe(false);
  });
});
