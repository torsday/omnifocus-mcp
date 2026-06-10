/**
 * Unit tests for the OmniJS perspective evaluation scripts.
 *
 * The scripts run inside OmniFocus's `evaluateJavascript` bridge, which the
 * bridge-mock tests never exercise — they only assert canned stdout. Here we
 * evaluate the actual script source (inlined as a string by
 * `scriptInlinerVitePlugin`) in a `node:vm` context against a minimal mock of
 * the OmniJS globals (`Task`, `Perspective`, `document`, `Application`,
 * `deleteObject`), so the in-script mapping logic is pinned without live
 * OmniFocus.
 *
 * Mock fidelity notes (verified against live OmniFocus 4.x):
 * - OmniJS `Task` has NO `blocked` / `available` / `dropped` booleans — only
 *   `taskStatus`, an identity-compared `Task.Status` enum value. The fake
 *   tasks deliberately omit those properties.
 * - OmniJS `Task.RepetitionRule` exposes only `ruleString` (RFC 5545 RRULE)
 *   and `method` (a `Task.RepetitionMethod` enum value) — no `unit`/`steps`.
 *
 * @see src/scripts/omnijs/perspective_evaluate.js
 * @see src/scripts/omnijs/perspective_evaluate_dry_run.js
 */

import vm from "node:vm";
import { describe, expect, it } from "vitest";
import perspectiveEvaluateScript from "./perspective_evaluate.js";
import perspectiveEvaluateDryRunScript from "./perspective_evaluate_dry_run.js";

// ---------------------------------------------------------------------------
// Mock OmniJS globals
// ---------------------------------------------------------------------------

/**
 * Fake `Task` constructor — the scripts use `obj instanceof Task` plus the
 * `Task.Status` / `Task.RepetitionMethod` enums hung off the constructor.
 * `instanceof` is identity-based on the prototype chain, so instances built
 * here are recognized inside the vm context.
 */
class FakeTask {
  constructor(props: Record<string, unknown>) {
    Object.assign(this, props);
  }
}

/** Unique sentinel objects mirroring OmniJS enum values (identity-compared). */
const TaskStatus = {
  Available: { label: "Available" },
  Blocked: { label: "Blocked" },
  Next: { label: "Next" },
  DueSoon: { label: "DueSoon" },
  Overdue: { label: "Overdue" },
  Completed: { label: "Completed" },
  Dropped: { label: "Dropped" },
} as const;

const RepetitionMethod = {
  None: { label: "None" },
  Fixed: { label: "Fixed" },
  DueDate: { label: "DueDate" },
  DeferUntilDate: { label: "DeferUntilDate" },
} as const;

(FakeTask as unknown as Record<string, unknown>).Status = TaskStatus;
(FakeTask as unknown as Record<string, unknown>).RepetitionMethod = RepetitionMethod;

function makeTask(props: Record<string, unknown>): FakeTask {
  return new FakeTask({
    id: { primaryKey: String(props.name ?? "task") },
    name: "task",
    note: null,
    tags: [],
    containingProject: null,
    parent: null,
    deferDate: null,
    dueDate: null,
    estimatedMinutes: null,
    flagged: false,
    completed: false,
    completionDate: null,
    dropDate: null,
    taskStatus: TaskStatus.Available,
    sequential: false,
    completedByChildren: false,
    repetitionRule: null,
    added: new Date("2026-01-01T00:00:00Z"),
    modified: new Date("2026-01-02T00:00:00Z"),
    ...props,
  });
}

interface MockWindow {
  perspective: unknown;
  content: { rootNode: unknown };
}

/**
 * Build a fake front window. Every `perspective` assignment is recorded in
 * `events` ("restore-perspective" when set back to the initial value,
 * "switch-perspective" otherwise) so tests can assert ordering against
 * `deleteObject` calls.
 */
function makeWindow(initialPerspective: unknown, tasks: FakeTask[], events: string[]): MockWindow {
  const rootNode = {
    object: null,
    children: tasks.map((t) => ({ object: t, children: [] })),
  };
  let current = initialPerspective;
  return {
    get perspective() {
      return current;
    },
    set perspective(p: unknown) {
      current = p;
      events.push(p === initialPerspective ? "restore-perspective" : "switch-perspective");
    },
    content: { rootNode },
  };
}

interface ScriptTask extends Record<string, unknown> {
  name: string;
}

function runEvaluate(opts: { tasks: FakeTask[]; events?: string[]; breakWalk?: boolean }): {
  result: { tasks: ScriptTask[] };
  win: MockWindow;
  userPerspective: unknown;
} {
  const events = opts.events ?? [];
  const evaluated = { name: "Custom-1" };
  const userPerspective = { name: "Forecast" };
  const win = makeWindow(userPerspective, opts.tasks, events);
  if (opts.breakWalk) {
    Object.defineProperty(win, "content", {
      get() {
        throw new Error("window has no content");
      },
    });
  }
  const context = {
    __args: { identifier: "persp-1" },
    Task: FakeTask,
    Perspective: {
      Custom: { byIdentifier: (id: string) => (id === "persp-1" ? evaluated : null) },
    },
    document: { windows: [win] },
  };
  vm.createContext(context);
  const raw = vm.runInContext(perspectiveEvaluateScript, context) as string;
  return { result: JSON.parse(raw), win, userPerspective };
}

function runDryRun(opts: { tasks: FakeTask[]; events?: string[]; breakWalk?: boolean }): {
  result: { tasks?: ScriptTask[]; error?: { code: string; message: string } };
  win: MockWindow;
  userPerspective: unknown;
  events: string[];
} {
  const events = opts.events ?? [];
  const userPerspective = { name: "Forecast" };
  const customAll: Array<{ name: string }> = [];
  const win = makeWindow(userPerspective, opts.tasks, events);
  if (opts.breakWalk) {
    Object.defineProperty(win, "content", {
      get() {
        throw new Error("window has no content");
      },
    });
  }
  const context = {
    __args: { aggregation: "all", rules: [{ actionAvailability: "available" }] },
    Task: FakeTask,
    Perspective: { Custom: { all: customAll } },
    document: { windows: [win] },
    Application: () => ({
      make: ({ withProperties }: { withProperties: { name: string } }) => {
        const made = { name: withProperties.name };
        customAll.push(made);
        return made;
      },
    }),
    deleteObject: (_persp: unknown) => {
      events.push("delete-perspective");
    },
  };
  vm.createContext(context);
  const raw = vm.runInContext(perspectiveEvaluateDryRunScript, context) as string;
  return { result: JSON.parse(raw), win, userPerspective, events };
}

// ---------------------------------------------------------------------------
// blocked / available / dropped — derived from taskStatus
// ---------------------------------------------------------------------------

const STATUS_TASKS = [
  makeTask({ name: "blocked", taskStatus: TaskStatus.Blocked }),
  makeTask({ name: "available", taskStatus: TaskStatus.Available }),
  makeTask({ name: "next", taskStatus: TaskStatus.Next }),
  makeTask({ name: "due-soon", taskStatus: TaskStatus.DueSoon }),
  makeTask({ name: "overdue", taskStatus: TaskStatus.Overdue }),
  makeTask({ name: "completed", taskStatus: TaskStatus.Completed, completed: true }),
  makeTask({ name: "dropped", taskStatus: TaskStatus.Dropped }),
];

function expectStatusMapping(tasks: ScriptTask[]): void {
  const byName = Object.fromEntries(tasks.map((t) => [t.name, t]));
  expect(byName.blocked).toMatchObject({ blocked: true, available: false, dropped: false });
  expect(byName.available).toMatchObject({ blocked: false, available: true, dropped: false });
  expect(byName.next).toMatchObject({ blocked: false, available: true });
  expect(byName["due-soon"]).toMatchObject({ blocked: false, available: true });
  expect(byName.overdue).toMatchObject({ blocked: false, available: true });
  expect(byName.completed).toMatchObject({ blocked: false, available: false, completed: true });
  expect(byName.dropped).toMatchObject({ blocked: false, available: false, dropped: true });
}

describe("perspective_evaluate.js — taskStatus mapping", () => {
  it("derives blocked/available/dropped from taskStatus (OmniJS has no boolean props)", () => {
    const { result } = runEvaluate({ tasks: STATUS_TASKS });
    expect(result.tasks).toHaveLength(STATUS_TASKS.length);
    expectStatusMapping(result.tasks);
  });
});

describe("perspective_evaluate_dry_run.js — taskStatus mapping", () => {
  it("derives blocked/available/dropped from taskStatus (OmniJS has no boolean props)", () => {
    const { result } = runDryRun({ tasks: STATUS_TASKS });
    expect(result.error).toBeUndefined();
    expectStatusMapping(result.tasks ?? []);
  });
});
