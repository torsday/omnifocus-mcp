/**
 * Pure parser for OmniFocus transport text DSL.
 *
 * Transport text format:
 *   Task name @tag1 @tag2 #due-date ::defer-date !! //note
 *   Project: SomeProject  (sets project context for subsequent tasks)
 *
 * No I/O, no OmniFocus calls. Safe to call in any context.
 *
 * @see https://support.omnigroup.com/omnifocus-mail-drop/
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedTask {
  name: string;
  note?: string;
  flagged?: boolean;
  dueDate?: string;
  deferDate?: string;
  tagNames?: string[];
  projectName?: string;
}

export interface ParseTransportTextResult {
  tasks: ParsedTask[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Format a Date as ISO-8601 with local UTC offset (e.g. "2026-04-23T00:00:00+05:30").
 * We want midnight local time so we build from local date parts.
 */
function toIsoWithOffset(date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());

  const offsetMin = -date.getTimezoneOffset(); // getTimezoneOffset() returns UTC-local
  const sign = offsetMin >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMin);
  const oh = pad(Math.floor(absMin / 60));
  const om = pad(absMin % 60);

  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${oh}:${om}`;
}

function parseDateToken(
  raw: string,
  lineNum: number,
  kind: "Due" | "Defer",
): {
  value: string;
  warning?: string;
} {
  const lower = raw.toLowerCase();
  const now = new Date();

  if (lower === "today") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    return { value: toIsoWithOffset(d) };
  }

  if (lower === "tomorrow") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    return { value: toIsoWithOffset(d) };
  }

  // Try strict ISO date (YYYY-MM-DD or full ISO-8601)
  const isoDate = /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(raw);
  if (isoDate) {
    // V8's Date parser leniently rolls out-of-range components over
    // ('2026-02-30' becomes Mar 2 instead of Invalid Date), so round-trip
    // the calendar components explicitly and warn instead of silently
    // shifting the date.
    const parts = raw.slice(0, 10).split("-");
    const yr = Number(parts[0]);
    const mo = Number(parts[1]);
    const dy = Number(parts[2]);
    const d = new Date(yr, mo - 1, dy, 0, 0, 0);
    if (d.getFullYear() !== yr || d.getMonth() !== mo - 1 || d.getDate() !== dy) {
      return {
        value: raw,
        warning: `Line ${lineNum}: ${kind} date '${raw}' is not a valid calendar date; passing through as-is`,
      };
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      // If it's a bare date (no time), treat as midnight local
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return { value: toIsoWithOffset(d) };
      }
      return { value: raw };
    }
  }

  return {
    value: raw,
    warning: `Line ${lineNum}: ${kind} date '${raw}' is not a recognized date format; passing through as-is`,
  };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseTransportText(text: string): ParseTransportTextResult {
  const lines = text.split("\n");
  const tasks: ParsedTask[] = [];
  const warnings: string[] = [];
  let currentProject: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = (lines[i] ?? "").trim();

    if (line === "") continue;

    // Project context line
    if (/^Project:\s*/i.test(line)) {
      currentProject = line.replace(/^Project:\s*/i, "").trim() || undefined;
      continue;
    }

    // Parse tokens from the line
    let remaining = line;
    const tagNames: string[] = [];
    let dueDate: string | undefined;
    let deferDate: string | undefined;
    let flagged = false;
    let note: string | undefined;

    // Extract note (// to end of line) first, to avoid interfering with other
    // tokens. The marker only counts at a token boundary (line start or after
    // whitespace) so the '//' inside URL schemes (https://, file://) never
    // splits the line.
    const noteMatch = remaining.match(/(^|\s)\/\//);
    if (noteMatch?.index !== undefined) {
      const noteIdx = noteMatch.index + (noteMatch[1]?.length ?? 0);
      note = remaining.slice(noteIdx + 2).trim();
      remaining = remaining.slice(0, noteIdx).trim();
    }

    // Split by whitespace; classify each token. Multi-word task names are
    // whatever remains after removing all special tokens.
    const parts = remaining.split(/\s+/).filter((p) => p.length > 0);
    const nameParts: string[] = [];

    for (const part of parts) {
      if (part === "!!") {
        flagged = true;
      } else if (part.startsWith("::")) {
        const raw = part.slice(2);
        if (raw.length > 0) {
          const { value, warning } = parseDateToken(raw, lineNum, "Defer");
          deferDate = value;
          if (warning) warnings.push(warning);
        }
      } else if (part.startsWith("@")) {
        const tag = part.slice(1);
        if (tag.length > 0) tagNames.push(tag);
      } else if (part.startsWith("#")) {
        const raw = part.slice(1);
        if (raw.length > 0) {
          const { value, warning } = parseDateToken(raw, lineNum, "Due");
          dueDate = value;
          if (warning) warnings.push(warning);
        }
      } else {
        nameParts.push(part);
      }
    }

    const name = nameParts.join(" ").trim();
    if (name === "") {
      warnings.push(`Line ${lineNum}: task line has no name after removing tokens; skipping`);
      continue;
    }

    const task: ParsedTask = { name };
    if (note !== undefined && note.length > 0) task.note = note;
    if (flagged) task.flagged = true;
    if (dueDate !== undefined) task.dueDate = dueDate;
    if (deferDate !== undefined) task.deferDate = deferDate;
    if (tagNames.length > 0) task.tagNames = tagNames;
    if (currentProject !== undefined) task.projectName = currentProject;

    tasks.push(task);
  }

  return { tasks, warnings };
}
