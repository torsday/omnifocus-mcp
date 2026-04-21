import { describe, expect, it } from "vitest";
import { RepetitionRuleSchema, TaskSchema } from "./task.js";

const BASE_TASK = {
  id: "gHqVKr3xAWo",
  name: "Review Q2 budget",
  note: null,
  noteHtml: null,
  projectId: "pAbCdEfGhIj",
  parentId: null,
  tagIds: ["tWorK"],
  deferDate: null,
  dueDate: "2026-05-01T17:00:00-05:00",
  estimatedMinutes: 45,
  flagged: true,
  completed: false,
  completedAt: null,
  dropped: false,
  droppedAt: null,
  available: true,
  blocked: false,
  sequential: false,
  completedByChildren: false,
  repetition: null,
  createdAt: "2026-04-19T15:23:04-05:00",
  modifiedAt: "2026-04-19T15:23:04-05:00",
};

describe("TaskSchema", () => {
  it("round-trips a representative task", () => {
    const result = TaskSchema.parse(BASE_TASK);
    expect(result.id).toBe("gHqVKr3xAWo");
    expect(result.tagIds).toEqual(["tWorK"]);
    expect(result.dueDate).toBe("2026-05-01T17:00:00-05:00");
  });

  it("accepts an inbox task (null projectId)", () => {
    const result = TaskSchema.parse({ ...BASE_TASK, projectId: null });
    expect(result.projectId).toBeNull();
  });

  it("accepts empty tagIds array", () => {
    const result = TaskSchema.parse({ ...BASE_TASK, tagIds: [] });
    expect(result.tagIds).toHaveLength(0);
  });

  it("rejects a bare local date (no offset)", () => {
    expect(() => TaskSchema.parse({ ...BASE_TASK, dueDate: "2026-05-01T17:00:00" })).toThrow();
  });

  it("rejects a naked string where projectId is expected", () => {
    expect(() => TaskSchema.parse({ ...BASE_TASK, projectId: "ab" })).toThrow();
  });

  it("rejects a naked string where a tagId is expected", () => {
    expect(() => TaskSchema.parse({ ...BASE_TASK, tagIds: ["ab"] })).toThrow();
  });

  it("accepts null for all nullable date fields", () => {
    const result = TaskSchema.parse({
      ...BASE_TASK,
      deferDate: null,
      dueDate: null,
      completedAt: null,
      droppedAt: null,
    });
    expect(result.deferDate).toBeNull();
  });

  it("accepts a task with a repetition rule", () => {
    const result = TaskSchema.parse({
      ...BASE_TASK,
      repetition: { method: "fixed", unit: "weeks", steps: 1 },
    });
    expect(result.repetition?.method).toBe("fixed");
  });
});

describe("RepetitionRuleSchema", () => {
  it("accepts fixed/weeks/1", () => {
    const r = RepetitionRuleSchema.parse({ method: "fixed", unit: "weeks", steps: 1 });
    expect(r.unit).toBe("weeks");
  });

  it("accepts weekdays with unit=weeks", () => {
    const r = RepetitionRuleSchema.parse({
      method: "start-again",
      unit: "weeks",
      steps: 1,
      weekdays: ["monday", "wednesday"],
    });
    expect(r.weekdays).toEqual(["monday", "wednesday"]);
  });

  it("rejects weekdays when unit is not weeks", () => {
    expect(() =>
      RepetitionRuleSchema.parse({
        method: "fixed",
        unit: "days",
        steps: 1,
        weekdays: ["monday"],
      }),
    ).toThrow();
  });

  it("accepts monthlyAnchor with day", () => {
    const r = RepetitionRuleSchema.parse({
      method: "due-again",
      unit: "months",
      steps: 1,
      monthlyAnchor: { day: 15 },
    });
    expect(r.monthlyAnchor).toEqual({ day: 15 });
  });

  it("accepts monthlyAnchor with weekday+position", () => {
    const r = RepetitionRuleSchema.parse({
      method: "fixed",
      unit: "months",
      steps: 3,
      monthlyAnchor: { weekday: "friday", position: "last" },
    });
    expect(r.monthlyAnchor).toEqual({ weekday: "friday", position: "last" });
  });

  it("rejects monthlyAnchor when unit is not months", () => {
    expect(() =>
      RepetitionRuleSchema.parse({
        method: "fixed",
        unit: "weeks",
        steps: 1,
        monthlyAnchor: { day: 15 },
      }),
    ).toThrow();
  });

  it("rejects both weekdays and monthlyAnchor set simultaneously", () => {
    expect(() =>
      RepetitionRuleSchema.parse({
        method: "fixed",
        unit: "weeks",
        steps: 1,
        weekdays: ["monday"],
        monthlyAnchor: { day: 1 },
      }),
    ).toThrow();
  });

  it("rejects steps < 1", () => {
    expect(() => RepetitionRuleSchema.parse({ method: "fixed", unit: "days", steps: 0 })).toThrow();
  });
});
