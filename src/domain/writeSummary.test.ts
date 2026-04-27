import { describe, expect, it } from "vitest";
import {
  summaryBatchComplete,
  summaryBatchCreate,
  summaryBatchDelete,
  summaryBatchDrop,
  summaryBatchMove,
  summaryBatchUncomplete,
  summaryBatchUndrop,
  summaryBatchUpdate,
  summaryFolderCreate,
  summaryFolderDelete,
  summaryFolderMove,
  summaryFolderUpdate,
  summaryNoteAppend,
  summaryNoteSet,
  summaryProjectComplete,
  summaryProjectCreate,
  summaryProjectDelete,
  summaryProjectDrop,
  summaryProjectMarkReviewed,
  summaryProjectMove,
  summaryProjectSetNextReviewDate,
  summaryProjectSetReviewInterval,
  summaryProjectUpdate,
  summarySetForecastTag,
  summaryTagCreate,
  summaryTagDelete,
  summaryTagMove,
  summaryTagUpdate,
  summaryTaskClearAlarms,
  summaryTaskClearRepetition,
  summaryTaskComplete,
  summaryTaskConvertToProject,
  summaryTaskCreate,
  summaryTaskDelete,
  summaryTaskDrop,
  summaryTaskDuplicate,
  summaryTaskMove,
  summaryTaskReorder,
  summaryTaskSetAlarms,
  summaryTaskSetRepetition,
  summaryTaskUncomplete,
  summaryTaskUndrop,
  summaryTaskUpdate,
} from "./writeSummary.js";

describe("writeSummary — task", () => {
  it("create", () => expect(summaryTaskCreate("Buy milk")).toBe("Created task 'Buy milk'."));
  it("update", () => expect(summaryTaskUpdate("Buy milk")).toBe("Updated task 'Buy milk'."));
  it("complete", () => expect(summaryTaskComplete("Buy milk")).toBe("Completed task 'Buy milk'."));
  it("uncomplete", () =>
    expect(summaryTaskUncomplete("Buy milk")).toBe("Uncompleted task 'Buy milk'."));
  it("delete", () => expect(summaryTaskDelete("Buy milk")).toBe("Deleted task 'Buy milk'."));
  it("drop", () => expect(summaryTaskDrop("Buy milk")).toBe("Dropped task 'Buy milk'."));
  it("undrop", () =>
    expect(summaryTaskUndrop("Buy milk")).toBe("Restored task 'Buy milk' from dropped."));
  it("move with destination", () =>
    expect(summaryTaskMove("Buy milk", "Errands")).toBe("Moved task 'Buy milk' to Errands."));
  it("duplicate", () =>
    expect(summaryTaskDuplicate("Buy milk")).toBe("Duplicated task 'Buy milk'."));
  it("reorder", () => expect(summaryTaskReorder("Buy milk")).toBe("Reordered task 'Buy milk'."));
  it("convertToProject", () =>
    expect(summaryTaskConvertToProject("Big thing")).toBe(
      "Converted task 'Big thing' to a project.",
    ));
  it("setRepetition", () =>
    expect(summaryTaskSetRepetition("Weekly review")).toBe(
      "Set repetition rule on task 'Weekly review'.",
    ));
  it("clearRepetition", () =>
    expect(summaryTaskClearRepetition("Weekly review")).toBe(
      "Cleared repetition rule on task 'Weekly review'.",
    ));
  it("setAlarms singular", () =>
    expect(summaryTaskSetAlarms("Call mom", 1)).toBe("Set 1 alarm on task 'Call mom'."));
  it("setAlarms plural", () =>
    expect(summaryTaskSetAlarms("Call mom", 3)).toBe("Set 3 alarms on task 'Call mom'."));
  it("clearAlarms", () =>
    expect(summaryTaskClearAlarms("Call mom")).toBe("Cleared alarms on task 'Call mom'."));

  it("truncates names longer than 140 chars", () => {
    const longName = "A".repeat(150);
    const result = summaryTaskCreate(longName);
    expect(result.length).toBeLessThanOrEqual(140);
    expect(result.endsWith("….")).toBe(false); // ends with … not ….
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("writeSummary — batch task", () => {
  it("create singular", () => expect(summaryBatchCreate(1)).toBe("Created 1 task."));
  it("create plural", () => expect(summaryBatchCreate(5)).toBe("Created 5 tasks."));
  it("update plural", () => expect(summaryBatchUpdate(3)).toBe("Updated 3 tasks."));
  it("complete plural", () => expect(summaryBatchComplete(2)).toBe("Completed 2 tasks."));
  it("uncomplete plural", () => expect(summaryBatchUncomplete(4)).toBe("Uncompleted 4 tasks."));
  it("delete plural", () => expect(summaryBatchDelete(7)).toBe("Deleted 7 tasks."));
  it("drop plural", () => expect(summaryBatchDrop(2)).toBe("Dropped 2 tasks."));
  it("undrop plural", () => expect(summaryBatchUndrop(3)).toBe("Restored 3 dropped tasks."));
  it("move plural", () => expect(summaryBatchMove(4, "Errands")).toBe("Moved 4 tasks to Errands."));
});

describe("writeSummary — project", () => {
  it("create", () => expect(summaryProjectCreate("Errands")).toBe("Created project 'Errands'."));
  it("update", () => expect(summaryProjectUpdate("Errands")).toBe("Updated project 'Errands'."));
  it("complete", () =>
    expect(summaryProjectComplete("Errands")).toBe("Completed project 'Errands'."));
  it("delete", () => expect(summaryProjectDelete("Errands")).toBe("Deleted project 'Errands'."));
  it("drop", () => expect(summaryProjectDrop("Errands")).toBe("Dropped project 'Errands'."));
  it("move", () =>
    expect(summaryProjectMove("Errands", "Personal folder")).toBe(
      "Moved project 'Errands' to Personal folder.",
    ));
  it("markReviewed", () =>
    expect(summaryProjectMarkReviewed("Errands")).toBe("Marked project 'Errands' as reviewed."));
  it("setReviewInterval singular", () =>
    expect(summaryProjectSetReviewInterval("Errands", 1)).toBe(
      "Set review interval for project 'Errands' to 1 day.",
    ));
  it("setReviewInterval plural", () =>
    expect(summaryProjectSetReviewInterval("Errands", 7)).toBe(
      "Set review interval for project 'Errands' to 7 days.",
    ));
  it("setNextReviewDate", () =>
    expect(summaryProjectSetNextReviewDate("Errands", "2026-12-31")).toBe(
      "Set next review date for project 'Errands' to 2026-12-31.",
    ));
});

describe("writeSummary — tag", () => {
  it("create", () => expect(summaryTagCreate("@home")).toBe("Created tag '@home'."));
  it("update", () => expect(summaryTagUpdate("@home")).toBe("Updated tag '@home'."));
  it("delete", () => expect(summaryTagDelete("@home")).toBe("Deleted tag '@home'."));
  it("move", () => expect(summaryTagMove("@home", "root")).toBe("Moved tag '@home' to root."));
});

describe("writeSummary — folder", () => {
  it("create", () => expect(summaryFolderCreate("Personal")).toBe("Created folder 'Personal'."));
  it("update", () => expect(summaryFolderUpdate("Personal")).toBe("Updated folder 'Personal'."));
  it("delete", () => expect(summaryFolderDelete("Personal")).toBe("Deleted folder 'Personal'."));
  it("move", () =>
    expect(summaryFolderMove("Personal", "library root")).toBe(
      "Moved folder 'Personal' to library root.",
    ));
});

describe("writeSummary — note", () => {
  it("set on task", () =>
    expect(summaryNoteSet("task", "Buy milk")).toBe("Set note on task 'Buy milk'."));
  it("set on project", () =>
    expect(summaryNoteSet("project", "Errands")).toBe("Set note on project 'Errands'."));
  it("append on task", () =>
    expect(summaryNoteAppend("task", "Buy milk")).toBe("Appended to note on task 'Buy milk'."));
});

describe("writeSummary — misc", () => {
  it("setForecastTag with name", () =>
    expect(summarySetForecastTag("@today")).toBe("Set forecast tag to '@today'."));
  it("setForecastTag null clears", () =>
    expect(summarySetForecastTag(null)).toBe("Cleared forecast tag."));
});
