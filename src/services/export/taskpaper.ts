/**
 * TaskPaper render + parse helpers for `ExportService.exportTaskPaper` and
 * `importTaskPaper`.
 *
 * TaskPaper is a plain-text outliner format native to the Mac app TaskPaper
 * and natively importable into OmniFocus. Render and parse live together
 * because round-trip invariants must stay in lockstep — a tag emitted by
 * `renderTaskPaper` should be understood by `parseTaskPaperLine`.
 *
 * These are pure functions with no adapter dependency; the service layer
 * orchestrates which tasks to fetch and which tag IDs to resolve.
 *
 * @see src/services/exportService.ts — orchestrator
 * @see src/services/export/opml.ts — sibling format
 */

import type { Task } from "../../domain/task.js";

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Render a task as a TaskPaper line (and recursively render its children).
 *
 * Tags emitted: `@tag-name` for each OF tag, `@due(date)`, `@defer(date)`,
 * `@flagged`, `@done`, `@dropped`.
 *
 * Lossiness notes pushed to `warnings`:
 * - HTML notes → plain note (fidelity lost, no warning needed)
 * - `noteHtml` when plain `note` is null — downgrade with warning
 */
export function renderTaskPaper(
  task: Task,
  byParent: Map<string, Task[]>,
  depth: number,
  lines: string[],
  warnings: string[],
): void {
  const indent = "\t".repeat(depth);
  const tags: string[] = [];

  // Tag attributes
  if (task.dueDate) tags.push(`@due(${task.dueDate.slice(0, 10)})`);
  if (task.deferDate) tags.push(`@defer(${task.deferDate.slice(0, 10)})`);
  if (task.flagged) tags.push("@flagged");
  if (task.completed) tags.push("@done");
  if (task.dropped) tags.push("@dropped");

  // TaskPaper has no native concept of tag IDs — we emit tag names when
  // available. Tag IDs are opaque; the import side resolves them by name.
  // (tag names are not in the Task domain model — only tagIds are carried;
  // the caller serialises names separately when needed)

  const tagStr = tags.length > 0 ? ` ${tags.join(" ")}` : "";
  lines.push(`${indent}- ${task.name}${tagStr}`);

  // Note as indented continuation lines
  const noteText = task.note ?? (task.noteHtml ? task.noteHtml.replace(/<[^>]*>/g, "") : null);
  if (noteText) {
    for (const noteLine of noteText.split("\n")) {
      if (noteLine.trim()) lines.push(`${indent}\t${noteLine}`);
    }
    if (task.noteHtml && !task.note) {
      warnings.push(`Task "${task.name}": HTML note downgraded to plain text`);
    }
  }

  // Recurse into children
  const children = byParent.get(String(task.id)) ?? [];
  for (const child of children) {
    renderTaskPaper(child, byParent, depth + 1, lines, warnings);
  }
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export interface ParsedTaskPaperLine {
  name: string;
  dueDate: string | undefined;
  deferDate: string | undefined;
  flagged: boolean;
  done: boolean;
  tagNames: string[];
  note: string | undefined;
}

/**
 * Parse a single TaskPaper task line (the text after the leading `- `).
 *
 * Extracts `@due(date)`, `@defer(date)`, `@flagged`, `@done`, and bare
 * `@tag` names. Dates are passed through as-is; callers may normalise them.
 */
export function parseTaskPaperLine(
  text: string,
  lineNum: number,
  warnings: string[],
): ParsedTaskPaperLine {
  let remaining = text;
  let dueDate: string | undefined;
  let deferDate: string | undefined;
  let flagged = false;
  let done = false;
  const tagNames: string[] = [];

  // Extract @due(date) and @defer(date)
  remaining = remaining.replace(/@due\(([^)]+)\)/g, (_, d: string) => {
    dueDate = normaliseDateToken(d.trim(), lineNum, warnings, "due");
    return "";
  });
  remaining = remaining.replace(/@defer\(([^)]+)\)/g, (_, d: string) => {
    deferDate = normaliseDateToken(d.trim(), lineNum, warnings, "defer");
    return "";
  });

  // Extract @flagged and @done
  remaining = remaining.replace(/@flagged/g, () => {
    flagged = true;
    return "";
  });
  remaining = remaining.replace(/@done/g, () => {
    done = true;
    return "";
  });
  remaining = remaining.replace(/@dropped/g, () => {
    done = true;
    return "";
  });

  // Extract bare @tag names (after removing the above known tags)
  remaining = remaining.replace(/@([\w-]+)/g, (_, name: string) => {
    if (
      name !== "due" &&
      name !== "defer" &&
      name !== "flagged" &&
      name !== "done" &&
      name !== "dropped"
    ) {
      tagNames.push(name);
    }
    return "";
  });

  // The task name is what's left, trimmed; note may be embedded after //
  const parts = remaining.split("//");
  const name = (parts[0] ?? "").trim();
  const note = parts[1] ? parts[1].trim() : undefined;

  if (!name) {
    warnings.push(`Line ${lineNum}: empty task name after parsing tags — skipped`);
  }

  return { name: name || "(unnamed)", dueDate, deferDate, flagged, done, tagNames, note };
}

/** Normalise a date token to ISO-8601 (YYYY-MM-DD → YYYY-MM-DDT00:00:00Z). */
function normaliseDateToken(
  raw: string,
  lineNum: number,
  warnings: string[],
  field: string,
): string | undefined {
  // Accept YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00Z`;
  // Accept full ISO-8601
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw;
  warnings.push(`Line ${lineNum}: unrecognised ${field} date format "${raw}" — skipped`);
  return undefined;
}

/** Count the number of leading tab characters on a line. */
export function countLeadingTabs(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === "\t") count++;
    else break;
  }
  return count;
}
