/**
 * Deterministic, template-based prose generators for write-tool humanReadableSummary.
 *
 * Rules (per ADR-0015 §3):
 * - One sentence, past tense, active voice ("Created…", "Updated…")
 * - Names not IDs — use the item's name when available
 * - ≤ 140 characters
 * - No model calls — purely template-driven
 */

import { truncateWithEllipsis } from "./text.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function q(name: string): string {
  return `'${name}'`;
}

/**
 * Cap a summary at 140 code points (per ADR-0015 §3), code-point-safe so a
 * multibyte name at the boundary isn't split into a lone surrogate (#834).
 */
function cap(s: string): string {
  return truncateWithEllipsis(s, 140);
}

// ---------------------------------------------------------------------------
// Task summaries
// ---------------------------------------------------------------------------

export function summaryTaskCreate(name: string): string {
  return cap(`Created task ${q(name)}.`);
}

export function summaryTaskUpdate(name: string): string {
  return cap(`Updated task ${q(name)}.`);
}

export function summaryTaskComplete(name: string): string {
  return cap(`Completed task ${q(name)}.`);
}

export function summaryTaskUncomplete(name: string): string {
  return cap(`Uncompleted task ${q(name)}.`);
}

export function summaryTaskDelete(name: string): string {
  return cap(`Deleted task ${q(name)}.`);
}

export function summaryTaskDrop(name: string): string {
  return cap(`Dropped task ${q(name)}.`);
}

export function summaryTaskUndrop(name: string): string {
  return cap(`Restored task ${q(name)} from dropped.`);
}

export function summaryTaskMove(name: string, destination: string): string {
  return cap(`Moved task ${q(name)} to ${destination}.`);
}

export function summaryTaskDuplicate(originalName: string): string {
  return cap(`Duplicated task ${q(originalName)}.`);
}

export function summaryTaskReorder(name: string): string {
  return cap(`Reordered task ${q(name)}.`);
}

export function summaryTaskConvertToProject(name: string): string {
  return cap(`Converted task ${q(name)} to a project.`);
}

export function summaryTaskSetRepetition(name: string): string {
  return cap(`Set repetition rule on task ${q(name)}.`);
}

export function summaryTaskClearRepetition(name: string): string {
  return cap(`Cleared repetition rule on task ${q(name)}.`);
}

export function summaryTaskSetAlarms(name: string, count: number): string {
  const noun = count === 1 ? "alarm" : "alarms";
  return cap(`Set ${count} ${noun} on task ${q(name)}.`);
}

export function summaryTaskClearAlarms(name: string): string {
  return cap(`Cleared alarms on task ${q(name)}.`);
}

// ---------------------------------------------------------------------------
// Batch task summaries
// ---------------------------------------------------------------------------

export function summaryBatchCreate(count: number): string {
  return `Created ${count} task${count === 1 ? "" : "s"}.`;
}

export function summaryBatchUpdate(count: number): string {
  return `Updated ${count} task${count === 1 ? "" : "s"}.`;
}

export function summaryBatchComplete(count: number): string {
  return `Completed ${count} task${count === 1 ? "" : "s"}.`;
}

export function summaryBatchUncomplete(count: number): string {
  return `Uncompleted ${count} task${count === 1 ? "" : "s"}.`;
}

export function summaryBatchDelete(count: number): string {
  return `Deleted ${count} task${count === 1 ? "" : "s"}.`;
}

export function summaryBatchDrop(count: number): string {
  return `Dropped ${count} task${count === 1 ? "" : "s"}.`;
}

export function summaryBatchUndrop(count: number): string {
  return `Restored ${count} dropped task${count === 1 ? "" : "s"}.`;
}

export function summaryBatchMove(count: number, destination: string): string {
  return cap(`Moved ${count} task${count === 1 ? "" : "s"} to ${destination}.`);
}

// ---------------------------------------------------------------------------
// Project summaries
// ---------------------------------------------------------------------------

export function summaryProjectCreate(name: string): string {
  return cap(`Created project ${q(name)}.`);
}

export function summaryProjectUpdate(name: string): string {
  return cap(`Updated project ${q(name)}.`);
}

export function summaryProjectComplete(name: string): string {
  return cap(`Completed project ${q(name)}.`);
}

export function summaryProjectDelete(name: string): string {
  return cap(`Deleted project ${q(name)}.`);
}

export function summaryProjectDrop(name: string): string {
  return cap(`Dropped project ${q(name)}.`);
}

export function summaryProjectMove(name: string, destination: string): string {
  return cap(`Moved project ${q(name)} to ${destination}.`);
}

export function summaryProjectMarkReviewed(name: string): string {
  return cap(`Marked project ${q(name)} as reviewed.`);
}

export function summaryProjectSetReviewInterval(name: string, days: number): string {
  return cap(`Set review interval for project ${q(name)} to ${days} day${days === 1 ? "" : "s"}.`);
}

export function summaryProjectSetNextReviewDate(name: string, date: string): string {
  return cap(`Set next review date for project ${q(name)} to ${date}.`);
}

export function summaryBatchCompleteProjects(count: number): string {
  return `Completed ${count} project${count === 1 ? "" : "s"}.`;
}

export function summaryBatchDropProjects(count: number): string {
  return `Dropped ${count} project${count === 1 ? "" : "s"}.`;
}

// ---------------------------------------------------------------------------
// Tag summaries
// ---------------------------------------------------------------------------

export function summaryTagCreate(name: string): string {
  return cap(`Created tag ${q(name)}.`);
}

export function summaryTagUpdate(name: string): string {
  return cap(`Updated tag ${q(name)}.`);
}

export function summaryTagDelete(name: string): string {
  return cap(`Deleted tag ${q(name)}.`);
}

export function summaryTagMove(name: string, destination: string): string {
  return cap(`Moved tag ${q(name)} to ${destination}.`);
}

// ---------------------------------------------------------------------------
// Folder summaries
// ---------------------------------------------------------------------------

export function summaryFolderCreate(name: string): string {
  return cap(`Created folder ${q(name)}.`);
}

export function summaryFolderUpdate(name: string): string {
  return cap(`Updated folder ${q(name)}.`);
}

export function summaryFolderDelete(name: string): string {
  return cap(`Deleted folder ${q(name)}.`);
}

export function summaryFolderMove(name: string, destination: string): string {
  return cap(`Moved folder ${q(name)} to ${destination}.`);
}

// ---------------------------------------------------------------------------
// Note summaries
// ---------------------------------------------------------------------------

export function summaryNoteSet(itemType: "task" | "project", name: string): string {
  return cap(`Set note on ${itemType} ${q(name)}.`);
}

export function summaryNoteAppend(itemType: "task" | "project", name: string): string {
  return cap(`Appended to note on ${itemType} ${q(name)}.`);
}

// ---------------------------------------------------------------------------
// Generic summaries (used when the item name is not available)
// ---------------------------------------------------------------------------

export function summaryProjectCompleteById(): string {
  return "Completed project.";
}

export function summaryProjectDropById(): string {
  return "Dropped project.";
}

export function summaryProjectMoveById(destination: string): string {
  return cap(`Moved project to ${destination}.`);
}

export function summaryTagDeleteById(): string {
  return "Deleted tag.";
}

export function summaryFolderDeleteById(): string {
  return "Deleted folder.";
}

export function summaryReviewMarkReviewed(): string {
  return "Marked project as reviewed.";
}

export function summaryReviewSetInterval(days: number | null): string {
  if (days === null) return "Cleared project review interval.";
  return `Set project review interval to ${days} day${days === 1 ? "" : "s"}.`;
}

export function summaryReviewSetNextReviewDate(date: string | null): string {
  if (date === null) return "Cleared project next review date.";
  return cap(`Set project next review date to ${date}.`);
}

// ---------------------------------------------------------------------------
// Misc summaries
// ---------------------------------------------------------------------------

export function summarySetForecastTag(tagName: string | null): string {
  return tagName === null ? "Cleared forecast tag." : cap(`Set forecast tag to ${q(tagName)}.`);
}
