import { describe, expect, it } from "vitest";
import { ProjectSchema } from "./project.js";

const BASE_PROJECT = {
  id: "pAbCdEfGhIj",
  name: "Q2 Budget Review",
  note: null,
  noteHtml: null,
  folderId: null,
  tagIds: [],
  status: "active",
  completionCriterion: "parallel",
  deferDate: null,
  dueDate: null,
  estimatedMinutes: null,
  flagged: false,
  reviewIntervalDays: 7,
  nextReviewDate: "2026-04-28T09:00:00-05:00",
  lastReviewDate: "2026-04-21T09:00:00-05:00",
  completed: false,
  completedAt: null,
  dropped: false,
  droppedAt: null,
  taskCount: 5,
  completedTaskCount: 2,
  createdAt: "2026-01-01T10:00:00Z",
  modifiedAt: "2026-04-19T15:23:04-05:00",
};

describe("ProjectSchema", () => {
  it("round-trips a representative project", () => {
    const result = ProjectSchema.parse(BASE_PROJECT);
    expect(result.id).toBe("pAbCdEfGhIj");
    expect(result.status).toBe("active");
    expect(result.completionCriterion).toBe("parallel");
    expect(result.taskCount).toBe(5);
  });

  it("accepts all status values", () => {
    for (const status of ["active", "on-hold", "done", "dropped"] as const) {
      const result = ProjectSchema.parse({ ...BASE_PROJECT, status });
      expect(result.status).toBe(status);
    }
  });

  it("accepts all completionCriterion values", () => {
    for (const cc of ["parallel", "sequential", "singleActions"] as const) {
      const result = ProjectSchema.parse({ ...BASE_PROJECT, completionCriterion: cc });
      expect(result.completionCriterion).toBe(cc);
    }
  });

  it("accepts a folderId", () => {
    const result = ProjectSchema.parse({ ...BASE_PROJECT, folderId: "fXyZaBcDeF" });
    expect(result.folderId).toBe("fXyZaBcDeF");
  });

  it("accepts tagIds", () => {
    const result = ProjectSchema.parse({ ...BASE_PROJECT, tagIds: ["tWorK"] });
    expect(result.tagIds).toEqual(["tWorK"]);
  });

  it("rejects a bare local date (no offset)", () => {
    expect(() =>
      ProjectSchema.parse({ ...BASE_PROJECT, dueDate: "2026-05-01T12:00:00" }),
    ).toThrow();
  });

  it("rejects an invalid projectId shape (too short)", () => {
    expect(() => ProjectSchema.parse({ ...BASE_PROJECT, id: "ab" })).toThrow();
  });

  it("rejects an invalid status", () => {
    expect(() => ProjectSchema.parse({ ...BASE_PROJECT, status: "archived" })).toThrow();
  });

  it("accepts null for all nullable review dates", () => {
    const result = ProjectSchema.parse({
      ...BASE_PROJECT,
      reviewIntervalDays: null,
      nextReviewDate: null,
      lastReviewDate: null,
    });
    expect(result.reviewIntervalDays).toBeNull();
  });

  it("accepts a completed project with timestamp", () => {
    const result = ProjectSchema.parse({
      ...BASE_PROJECT,
      status: "done",
      completed: true,
      completedAt: "2026-04-20T10:00:00Z",
    });
    expect(result.completedAt).toBe("2026-04-20T10:00:00Z");
  });
});
