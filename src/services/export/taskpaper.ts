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
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Local calendar day (`YYYY-MM-DD`) for an ISO instant. The adapter emits
 * Z-normalized timestamps, so slicing the first ten characters (the prior
 * implementation) yielded the *UTC* day — one day off from the user's
 * wall-clock whenever local midnight has passed but UTC's hasn't (or vice
 * versa). Same bug class as #1035; mirrors `localDayKey` in
 * `src/tools/forecast/get.ts`.
 *
 * `tz` is for tests; production callers omit it and get the host TZ, which
 * is the user's TZ per `docs/dates.md`.
 */
export function localDayKey(iso: string, tz?: string): string {
  // `en-CA` yields `YYYY-MM-DD` from numeric/2-digit options.
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  if (tz !== undefined) opts.timeZone = tz;
  return new Intl.DateTimeFormat("en-CA", opts).format(new Date(iso));
}

/**
 * Resolve a bare `YYYY-MM-DD` to midnight *local* time with an explicit
 * offset (e.g. `2026-06-10T00:00:00-07:00`). UTC midnight (the prior
 * behavior) lands on the previous local calendar day for every user west
 * of UTC; local midnight matches OmniFocus's own TaskPaper date handling
 * and the sibling transport-text parser
 * (`src/taskParser/transportText.ts`).
 */
function localMidnightIso(ymd: string): string {
  const parts = ymd.split("-");
  const yr = Number(parts[0]);
  const mo = Number(parts[1]);
  const dy = Number(parts[2]);
  // Construct from local parts so the offset is the one in effect on that
  // date (DST-aware), not today's. Format back from the Date's own parts
  // (not the raw token) so zones that skip midnight at a DST boundary
  // still serialize the instant the runtime actually resolved.
  const d = new Date(yr, mo - 1, dy, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  const offsetMin = -d.getTimezoneOffset(); // getTimezoneOffset() returns UTC-local
  const sign = offsetMin >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMin);
  return `${y}-${m}-${day}T${h}:${mi}:${s}${sign}${pad(Math.floor(absMin / 60))}:${pad(absMin % 60)}`;
}

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

  // Tag attributes — emit the *local* calendar day, matching what the user
  // sees in OmniFocus (see localDayKey above for why slicing would drift).
  if (task.dueDate) tags.push(`@due(${localDayKey(task.dueDate)})`);
  if (task.deferDate) tags.push(`@defer(${localDayKey(task.deferDate)})`);
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

  // The task name is what's left, trimmed; a note may be embedded after a
  // standalone `//`. The delimiter only counts when preceded by whitespace
  // (or starting the line) so URLs in task names (`https://…`) stay intact —
  // same delimiter rule as the transport-text parser
  // (src/taskParser/transportText.ts). Everything after the first delimiter
  // is the note, so later `//` occurrences are kept rather than discarded.
  const noteMatch = /(?:^|\s)\/\//.exec(remaining);
  const name = noteMatch === null ? remaining.trim() : remaining.slice(0, noteMatch.index).trim();
  const rawNote =
    noteMatch === null ? "" : remaining.slice(noteMatch.index + noteMatch[0].length).trim();
  const note = rawNote ? rawNote : undefined;

  if (!name) {
    warnings.push(`Line ${lineNum}: empty task name after parsing tags — skipped`);
  }

  return { name: name || "(unnamed)", dueDate, deferDate, flagged, done, tagNames, note };
}

/** Normalise a date token to ISO-8601 (YYYY-MM-DD → local midnight with offset). */
function normaliseDateToken(
  raw: string,
  lineNum: number,
  warnings: string[],
  field: string,
): string | undefined {
  // Accept YYYY-MM-DD — resolved to *local* midnight so the task lands on
  // the calendar day the file says, regardless of the user's TZ.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return localMidnightIso(raw);
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
