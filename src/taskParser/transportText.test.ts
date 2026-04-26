/**
 * Unit tests for the pure transport text parser.
 */

import { describe, expect, it } from "vitest";
import { parseTransportText } from "./transportText.js";

describe("parseTransportText — single task", () => {
  it("parses name only", () => {
    const { tasks, warnings } = parseTransportText("Buy groceries");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.name).toBe("Buy groceries");
    expect(warnings).toHaveLength(0);
  });

  it("parses @tag", () => {
    const { tasks } = parseTransportText("Buy groceries @errands");
    expect(tasks[0]?.tagNames).toEqual(["errands"]);
  });

  it("parses multiple @tags", () => {
    const { tasks } = parseTransportText("Buy groceries @errands @shopping");
    expect(tasks[0]?.tagNames).toEqual(["errands", "shopping"]);
  });

  it("parses !! as flagged", () => {
    const { tasks } = parseTransportText("Important task !!");
    expect(tasks[0]?.flagged).toBe(true);
  });

  it("parses #today as ISO date", () => {
    const { tasks, warnings } = parseTransportText("Task #today");
    expect(warnings).toHaveLength(0);
    expect(tasks[0]?.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00[+-]\d{2}:\d{2}$/);
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    expect(tasks[0]?.dueDate).toMatch(new RegExp(`^${y}-${m}-${d}`));
  });

  it("parses #tomorrow as ISO date one day ahead", () => {
    const { tasks, warnings } = parseTransportText("Task #tomorrow");
    expect(warnings).toHaveLength(0);
    expect(tasks[0]?.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00[+-]\d{2}:\d{2}$/);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, "0");
    const d = String(tomorrow.getDate()).padStart(2, "0");
    expect(tasks[0]?.dueDate).toMatch(new RegExp(`^${y}-${m}-${d}`));
  });

  it("parses #YYYY-MM-DD as ISO date", () => {
    const { tasks, warnings } = parseTransportText("Task #2026-05-01");
    expect(warnings).toHaveLength(0);
    expect(tasks[0]?.dueDate).toMatch(/^2026-05-01T/);
  });

  it("parses //note", () => {
    const { tasks } = parseTransportText("Task name //this is a note");
    expect(tasks[0]?.name).toBe("Task name");
    expect(tasks[0]?.note).toBe("this is a note");
  });

  it("parses ::defer date", () => {
    const { tasks, warnings } = parseTransportText("Task ::today");
    expect(warnings).toHaveLength(0);
    expect(tasks[0]?.deferDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("passes through unrecognized date format with warning", () => {
    const { tasks, warnings } = parseTransportText("Task #next-tuesday");
    expect(tasks[0]?.dueDate).toBe("next-tuesday");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("next-tuesday");
    expect(warnings[0]).toContain("not a recognized date format");
  });

  it("parses combination of all tokens", () => {
    const { tasks, warnings } = parseTransportText(
      "Buy milk @errands @shopping #tomorrow ::today !! //pick up 2%",
    );
    expect(warnings).toHaveLength(0);
    const [t] = tasks;
    if (!t) throw new Error("expected first task to be defined");
    expect(t.name).toBe("Buy milk");
    expect(t.tagNames).toEqual(["errands", "shopping"]);
    expect(t.flagged).toBe(true);
    expect(t.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(t.deferDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(t.note).toBe("pick up 2%");
  });
});

describe("parseTransportText — multi-line", () => {
  it("parses multiple tasks from newline-separated input", () => {
    const { tasks } = parseTransportText("Task one\nTask two\nTask three");
    expect(tasks).toHaveLength(3);
    expect(tasks[0]?.name).toBe("Task one");
    expect(tasks[1]?.name).toBe("Task two");
    expect(tasks[2]?.name).toBe("Task three");
  });

  it("skips empty lines", () => {
    const { tasks } = parseTransportText("Task one\n\nTask two");
    expect(tasks).toHaveLength(2);
  });

  it("Project: line sets projectName on subsequent tasks", () => {
    const input = "Project: Home\nBuy paint\nFix fence";
    const { tasks } = parseTransportText(input);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.projectName).toBe("Home");
    expect(tasks[1]?.projectName).toBe("Home");
  });

  it("Project: line does not create a task", () => {
    const { tasks } = parseTransportText("Project: Work\nSend email");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.name).toBe("Send email");
  });

  it("project context resets when a new Project: line appears", () => {
    const input = "Project: Home\nBuy paint\nProject: Work\nSend report";
    const { tasks } = parseTransportText(input);
    expect(tasks[0]?.projectName).toBe("Home");
    expect(tasks[1]?.projectName).toBe("Work");
  });
});
