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

// ---------------------------------------------------------------------------
// repetition — parsed from ruleString + RepetitionMethod enum
// ---------------------------------------------------------------------------

const REPETITION_TASKS = [
  makeTask({ name: "none", repetitionRule: null }),
  makeTask({
    name: "yearly-defer",
    repetitionRule: { ruleString: "FREQ=YEARLY", method: RepetitionMethod.DeferUntilDate },
  }),
  makeTask({
    name: "biweekly-due",
    repetitionRule: {
      ruleString: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH",
      method: RepetitionMethod.DueDate,
    },
  }),
  makeTask({
    name: "monthly-fixed",
    repetitionRule: { ruleString: "FREQ=MONTHLY;BYMONTHDAY=15", method: RepetitionMethod.Fixed },
  }),
  makeTask({
    name: "monthly-positional",
    repetitionRule: { ruleString: "FREQ=MONTHLY;BYDAY=-1FR", method: RepetitionMethod.Fixed },
  }),
  makeTask({
    name: "method-none",
    repetitionRule: { ruleString: "FREQ=DAILY", method: RepetitionMethod.None },
  }),
];

function expectRepetitionMapping(tasks: ScriptTask[]): void {
  const repetitionByName = Object.fromEntries(tasks.map((t) => [t.name, t.repetition]));
  expect(repetitionByName.none).toBeNull();
  expect(repetitionByName["yearly-defer"]).toEqual({
    method: "start-again",
    unit: "years",
    steps: 1,
  });
  expect(repetitionByName["biweekly-due"]).toEqual({
    method: "due-again",
    unit: "weeks",
    steps: 2,
    weekdays: ["tuesday", "thursday"],
  });
  expect(repetitionByName["monthly-fixed"]).toEqual({
    method: "fixed",
    unit: "months",
    steps: 1,
    monthlyAnchor: { day: 15 },
  });
  expect(repetitionByName["monthly-positional"]).toEqual({
    method: "fixed",
    unit: "months",
    steps: 1,
    monthlyAnchor: { weekday: "friday", position: "last" },
  });
  // RepetitionMethod.None means "does not repeat" — no rule reported.
  expect(repetitionByName["method-none"]).toBeNull();
}

describe("perspective_evaluate.js — repetition", () => {
  it("parses ruleString + RepetitionMethod enum into the domain RepetitionRule shape", () => {
    const { result } = runEvaluate({ tasks: REPETITION_TASKS });
    expectRepetitionMapping(result.tasks);
  });
});

describe("perspective_evaluate_dry_run.js — repetition", () => {
  it("parses ruleString + RepetitionMethod enum into the domain RepetitionRule shape", () => {
    const { result } = runDryRun({ tasks: REPETITION_TASKS });
    expect(result.error).toBeUndefined();
    expectRepetitionMapping(result.tasks ?? []);
  });
});

// ---------------------------------------------------------------------------
// window perspective restore — no side effects contract
// ---------------------------------------------------------------------------

describe("perspective_evaluate.js — window restore", () => {
  it("restores the user's window perspective after evaluation", () => {
    const events: string[] = [];
    const { win, userPerspective } = runEvaluate({ tasks: STATUS_TASKS, events });
    expect(win.perspective).toBe(userPerspective);
    expect(events).toEqual(["switch-perspective", "restore-perspective"]);
  });

  it("restores the user's window perspective even when the walk throws", () => {
    const events: string[] = [];
    expect(() => runEvaluate({ tasks: [], events, breakWalk: true })).toThrow(
      "window has no content",
    );
    expect(events).toEqual(["switch-perspective", "restore-perspective"]);
  });
});

describe("perspective_evaluate_dry_run.js — window restore", () => {
  it("restores the user's window perspective before deleting the temp perspective", () => {
    const events: string[] = [];
    const { result, win, userPerspective } = runDryRun({ tasks: STATUS_TASKS, events });
    expect(result.error).toBeUndefined();
    expect(win.perspective).toBe(userPerspective);
    // Restore must precede deletion so the window never displays a deleted
    // perspective.
    expect(events).toEqual(["switch-perspective", "restore-perspective", "delete-perspective"]);
  });

  it("restores the window and rolls back the temp perspective when the walk throws", () => {
    const events: string[] = [];
    const { result, win, userPerspective } = runDryRun({ tasks: [], events, breakWalk: true });
    expect(result.error).toMatchObject({ code: "SCRIPT_ERROR" });
    expect(win.perspective).toBe(userPerspective);
    expect(events).toEqual(["switch-perspective", "restore-perspective", "delete-perspective"]);
  });
});
