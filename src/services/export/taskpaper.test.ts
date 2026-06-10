/**
 * Unit tests for the pure TaskPaper render/parse helpers.
 *
 * Service-level orchestration (scopes, tag resolution, round-trips) is
 * covered in `src/services/exportService.taskpaper.test.ts`; this file pins
 * the TZ-sensitive date handling. Export must emit the *local* calendar day
 * and import must resolve bare dates to *local* midnight — slicing /
 * UTC-midnight semantics drift a day for non-UTC users (#1035 bug class).
 * `localDayKey` cases use explicit timezones so they are deterministic on
 * any host; render/parse cases build expectations from local date parts.
 */

import { describe, expect, it } from "vitest";
import type { TaskId } from "../../domain/ids.js";
import { TaskId as TaskIdCtor } from "../../domain/ids.js";
import type { Task } from "../../domain/task.js";
import {
  escapeNoteLine,
  localDayKey,
  parseTaskPaperLine,
  renderTaskPaper,
  unescapeNoteLine,
} from "./taskpaper.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = "2026-01-01T00:00:00.000Z";

function makeTask(overrides: Partial<Task> & { id: TaskId }): Task {
  return {
    name: "Task",
    note: null,
    noteHtml: null,
    projectId: null,
    parentId: null,
    tagIds: [],
    deferDate: null,
    dueDate: null,
    estimatedMinutes: null,
    flagged: false,
    completed: false,
    completedAt: null,
    dropped: false,
    droppedAt: null,
    available: true,
    blocked: false,
    sequential: false,
    completedByChildren: false,
    repetition: null,
    createdAt: NOW,
    modifiedAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// localDayKey
// ---------------------------------------------------------------------------

describe("localDayKey", () => {
  it("returns the local calendar day, not the UTC day, west of UTC", () => {
    // 2026-05-27T06:00:00Z is 23:00 on May 26 in Los Angeles.
    expect(localDayKey("2026-05-27T06:00:00Z", "America/Los_Angeles")).toBe("2026-05-26");
  });

  it("matches the UTC day when the zone is UTC", () => {
    expect(localDayKey("2026-05-27T06:00:00Z", "UTC")).toBe("2026-05-27");
  });

  it("rolls the day forward east of UTC", () => {
    // 23:30Z on May 26 is already May 27 in Tokyo.
    expect(localDayKey("2026-05-26T23:30:00Z", "Asia/Tokyo")).toBe("2026-05-27");
  });
});

// ---------------------------------------------------------------------------
// renderTaskPaper — date tags
// ---------------------------------------------------------------------------

describe("renderTaskPaper — @due/@defer calendar day", () => {
  it("emits the host-local calendar day for due and defer dates", () => {
    // Instants built from *local* parts, so the expected day below is
    // host-TZ-independent — while the Z-normalized storage form crosses a
    // UTC day boundary in any non-UTC zone (late evening west of UTC,
    // early morning east of it).
    const due = new Date(2026, 5, 9, 23, 0, 0); // 23:00 local, June 9
    const defer = new Date(2026, 5, 1, 0, 30, 0); // 00:30 local, June 1
    const task = makeTask({
      id: TaskIdCtor.of("task-aaa"),
      name: "Late",
      dueDate: due.toISOString(),
      deferDate: defer.toISOString(),
    });

    const lines: string[] = [];
    renderTaskPaper(task, new Map(), 0, lines, []);

    expect(lines[0]).toContain("@due(2026-06-09)");
    expect(lines[0]).toContain("@defer(2026-06-01)");
  });
});

// ---------------------------------------------------------------------------
// parseTaskPaperLine — bare dates
// ---------------------------------------------------------------------------

describe("parseTaskPaperLine — bare date tokens", () => {
  it("resolves YYYY-MM-DD to local midnight with an explicit offset", () => {
    const parsed = parseTaskPaperLine("Task @due(2026-06-10)", 1, []);
    expect(parsed.dueDate).toMatch(/^2026-06-10T00:00:00[+-]\d{2}:\d{2}$/);
    // The instant must be midnight June 10 on the host's wall clock.
    const d = new Date(parsed.dueDate ?? "");
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]).toEqual([
      2026, 6, 10, 0,
    ]);
  });

  it("resolves @defer the same way", () => {
    const parsed = parseTaskPaperLine("Task @defer(2026-05-15)", 1, []);
    expect(parsed.deferDate).toMatch(/^2026-05-15T00:00:00[+-]\d{2}:\d{2}$/);
  });

  it("passes full ISO-8601 datetimes through unchanged", () => {
    const parsed = parseTaskPaperLine("Task @due(2026-06-10T17:00:00Z)", 1, []);
    expect(parsed.dueDate).toBe("2026-06-10T17:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// escapeNoteLine / unescapeNoteLine
// ---------------------------------------------------------------------------

describe("escapeNoteLine / unescapeNoteLine", () => {
  it("escapes dash-leading note lines with one space", () => {
    expect(escapeNoteLine("- buy milk")).toBe(" - buy milk");
  });

  it("escapes already-space-prefixed dash lines so the pair stays bijective", () => {
    expect(escapeNoteLine(" - nested bullet")).toBe("  - nested bullet");
  });

  it("leaves plain note lines untouched", () => {
    expect(escapeNoteLine("plain text")).toBe("plain text");
    expect(escapeNoteLine("-not a bullet")).toBe("-not a bullet");
  });

  it("round-trips through unescapeNoteLine", () => {
    for (const line of ["- buy milk", " - nested", "plain", "-joined", "\tindented", "-"]) {
      expect(unescapeNoteLine(escapeNoteLine(line))).toBe(line);
    }
  });
});

// ---------------------------------------------------------------------------
// renderTaskPaper — note emission
// ---------------------------------------------------------------------------

describe("renderTaskPaper — dash-leading note lines", () => {
  it("space-escapes note lines that would parse as task lines", () => {
    const task = makeTask({
      id: TaskIdCtor.of("task-aaa"),
      name: "Shopping",
      note: "Checklist:\n- buy milk\n- buy eggs",
    });

    const lines: string[] = [];
    renderTaskPaper(task, new Map(), 1, lines, []);

    expect(lines).toEqual(["\t- Shopping", "\t\tChecklist:", "\t\t - buy milk", "\t\t - buy eggs"]);
  });
});

// ---------------------------------------------------------------------------
// parseTaskPaperLine — @done(date)
// ---------------------------------------------------------------------------

describe("parseTaskPaperLine — @done(date)", () => {
  it("captures the completion date and leaves no residue in the name", () => {
    const parsed = parseTaskPaperLine("Ship it @done(2026-05-05)", 1, []);
    expect(parsed.name).toBe("Ship it");
    expect(parsed.done).toBe(true);
    expect(parsed.doneDate).toMatch(/^2026-05-05T00:00:00[+-]\d{2}:\d{2}$/);
  });

  it("still accepts bare @done with no date", () => {
    const parsed = parseTaskPaperLine("Ship it @done", 1, []);
    expect(parsed.name).toBe("Ship it");
    expect(parsed.done).toBe(true);
    expect(parsed.doneDate).toBeUndefined();
  });

  it("strips a parenthesized @dropped argument and keeps dropped distinct from done", () => {
    const parsed = parseTaskPaperLine("Old idea @dropped(2026-04-01)", 1, []);
    expect(parsed.name).toBe("Old idea");
    expect(parsed.dropped).toBe(true);
    expect(parsed.done).toBe(false);
    expect(parsed.droppedDate).toMatch(/^2026-04-01T00:00:00[+-]\d{2}:\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// parseTaskPaperLine — `//` note delimiter
// ---------------------------------------------------------------------------

describe("parseTaskPaperLine — `//` note delimiter", () => {
  it("keeps URLs in the task name intact (`//` without leading whitespace is not a delimiter)", () => {
    const parsed = parseTaskPaperLine("Read https://example.com/docs", 1, []);
    expect(parsed.name).toBe("Read https://example.com/docs");
    expect(parsed.note).toBeUndefined();
  });

  it("splits name and note on a whitespace-preceded `//`", () => {
    const parsed = parseTaskPaperLine("Task // note here", 1, []);
    expect(parsed.name).toBe("Task");
    expect(parsed.note).toBe("note here");
  });

  it("keeps later `//` occurrences inside the note instead of discarding them", () => {
    const parsed = parseTaskPaperLine("Task // see https://example.com // and more", 1, []);
    expect(parsed.name).toBe("Task");
    expect(parsed.note).toBe("see https://example.com // and more");
  });
});
