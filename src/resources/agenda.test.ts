/**
 * Unit tests for `omnifocus://agenda{?date}` — calendar + forecast merge.
 */

import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../bridge/calendarBridge.js";
import { ProjectId, TaskId } from "../domain/ids.js";
import type { Task } from "../domain/task.js";
import {
  _AgendaCache,
  AGENDA_URI_TEMPLATE,
  buildAgendaPayload,
  DEFAULT_AGENDA_TTL_MS,
} from "./agenda.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TaskId.of("task-1"),
    name: "task one",
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
    inInbox: true,
    sequential: false,
    completedByChildren: false,
    repetitionRule: null,
    blocked: false,
    next: false,
    available: true,
    createdAt: "2026-04-29T08:00:00.000Z",
    modifiedAt: "2026-04-29T08:00:00.000Z",
    ...overrides,
  } as Task;
}

const calendarEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "evt-1",
  title: "Standup",
  startsAt: "2026-04-29T09:00:00-05:00",
  endsAt: "2026-04-29T09:30:00-05:00",
  allDay: false,
  calendarName: "Work",
  calendarSource: "iCloud",
  status: "confirmed",
  ...overrides,
});

const emptyForecast = {
  overdue: [],
  dueToday: [],
  deferredToday: [],
  flagged: [],
  cacheHit: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AGENDA_URI_TEMPLATE", () => {
  it("uses RFC 6570 query expansion for date", () => {
    expect(AGENDA_URI_TEMPLATE).toBe("omnifocus://agenda{?date}");
  });
});

describe("buildAgendaPayload — merge ordering", () => {
  it("interleaves calendar events and timed OF tasks sorted by startsAt", async () => {
    const events = [
      calendarEvent({ id: "a", title: "Standup", startsAt: "2026-04-29T09:00:00-05:00" }),
      calendarEvent({ id: "b", title: "Review", startsAt: "2026-04-29T14:00:00-05:00" }),
    ];
    const tasks: Task[] = [
      makeTask({
        id: TaskId.of("task-001"),
        name: "Submit report",
        dueDate: "2026-04-29T11:00:00-05:00",
      }),
    ];
    const bridge = { readEvents: vi.fn().mockResolvedValue(events) };
    const forecastService = {
      get: vi.fn().mockResolvedValue({ ...emptyForecast, dueToday: tasks }),
    };

    const payload = await buildAgendaPayload(
      { bridge, forecastService, cache: new _AgendaCache() },
      { date: "2026-04-29T00:00:00-05:00" },
    );

    expect(payload.items.map((i) => (i.kind === "calendar-event" ? i.title : i.name))).toEqual([
      "Standup",
      "Submit report",
      "Review",
    ]);
    expect(payload.floating).toEqual([]);
  });

  it("places OF tasks without a dueDate into floating, sorted by name", async () => {
    const tasks: Task[] = [
      makeTask({ id: TaskId.of("zebra-id"), name: "zebra task" }),
      makeTask({ id: TaskId.of("apple-id"), name: "apple task" }),
    ];
    const bridge = { readEvents: vi.fn().mockResolvedValue([]) };
    const forecastService = {
      get: vi.fn().mockResolvedValue({ ...emptyForecast, flagged: tasks }),
    };

    const payload = await buildAgendaPayload(
      { bridge, forecastService, cache: new _AgendaCache() },
      { date: "2026-04-29T00:00:00-05:00" },
    );

    expect(payload.items).toEqual([]);
    expect(payload.floating.map((i) => (i.kind === "of-task" ? i.name : ""))).toEqual([
      "apple task",
      "zebra task",
    ]);
  });

  it("de-duplicates tasks that appear in multiple forecast categories", async () => {
    const t = makeTask({
      id: TaskId.of("t-shared"),
      name: "Both due and flagged",
      dueDate: "2026-04-29T10:00:00-05:00",
      flagged: true,
    });
    const bridge = { readEvents: vi.fn().mockResolvedValue([]) };
    const forecastService = {
      get: vi.fn().mockResolvedValue({ ...emptyForecast, dueToday: [t], flagged: [t] }),
    };

    const payload = await buildAgendaPayload(
      { bridge, forecastService, cache: new _AgendaCache() },
      { date: "2026-04-29T00:00:00-05:00" },
    );

    expect(payload.items).toHaveLength(1);
    expect(payload.floating).toHaveLength(0);
  });

  it("tags items with their kind discriminator", async () => {
    const events = [calendarEvent()];
    const tasks: Task[] = [
      makeTask({ id: TaskId.of("task-001"), name: "Timed", dueDate: "2026-04-29T11:00:00-05:00" }),
      makeTask({ id: TaskId.of("task-002"), name: "Floating" }),
    ];
    const bridge = { readEvents: vi.fn().mockResolvedValue(events) };
    const forecastService = {
      get: vi.fn().mockResolvedValue({ ...emptyForecast, flagged: tasks }),
    };

    const payload = await buildAgendaPayload(
      { bridge, forecastService, cache: new _AgendaCache() },
      { date: "2026-04-29T00:00:00-05:00" },
    );

    expect(payload.items[0]?.kind).toBe("calendar-event");
    expect(payload.items[1]?.kind).toBe("of-task");
    expect(payload.floating[0]?.kind).toBe("of-task");
  });
});

describe("buildAgendaPayload — defaults", () => {
  it("defaults date to today's local-zone day when omitted", async () => {
    const fixedNow = new Date("2026-04-29T15:30:00.000Z");
    const bridge = { readEvents: vi.fn().mockResolvedValue([]) };
    const forecastService = { get: vi.fn().mockResolvedValue(emptyForecast) };

    await buildAgendaPayload({
      bridge,
      forecastService,
      now: () => fixedNow,
      cache: new _AgendaCache(),
    });

    expect(bridge.readEvents).toHaveBeenCalledTimes(1);
    expect(forecastService.get).toHaveBeenCalledTimes(1);
    const bridgeCall = bridge.readEvents.mock.calls[0] as [string, string, string | undefined];
    const fromDate = new Date(bridgeCall[0]);
    const toDate = new Date(bridgeCall[1]);
    expect(fromDate.getHours()).toBe(0);
    expect(toDate.getTime() - fromDate.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("forwards the OMNIFOCUS_CALENDAR_SOURCES env value to the bridge", async () => {
    const bridge = { readEvents: vi.fn().mockResolvedValue([]) };
    const forecastService = { get: vi.fn().mockResolvedValue(emptyForecast) };

    await buildAgendaPayload(
      { bridge, forecastService, sources: "Work,Personal", cache: new _AgendaCache() },
      { date: "2026-04-29T00:00:00-05:00" },
    );

    const args = bridge.readEvents.mock.calls[0] as [string, string, string | undefined];
    expect(args[2]).toBe("Work,Personal");
  });
});

describe("buildAgendaPayload — caching", () => {
  it("returns the cached payload within the TTL without re-fetching", async () => {
    const cache = new _AgendaCache();
    const bridge = { readEvents: vi.fn().mockResolvedValue([]) };
    const forecastService = { get: vi.fn().mockResolvedValue(emptyForecast) };
    let nowMs = 1_000_000_000_000;
    const now = () => new Date(nowMs);

    await buildAgendaPayload(
      { bridge, forecastService, now, cache },
      { date: "2026-04-29T00:00:00-05:00" },
    );
    nowMs += 30_000;
    await buildAgendaPayload(
      { bridge, forecastService, now, cache },
      { date: "2026-04-29T00:00:00-05:00" },
    );

    expect(bridge.readEvents).toHaveBeenCalledTimes(1);
    expect(forecastService.get).toHaveBeenCalledTimes(1);
  });

  it("refetches once the TTL has elapsed", async () => {
    const cache = new _AgendaCache();
    const bridge = { readEvents: vi.fn().mockResolvedValue([]) };
    const forecastService = { get: vi.fn().mockResolvedValue(emptyForecast) };
    let nowMs = 1_000_000_000_000;
    const now = () => new Date(nowMs);

    await buildAgendaPayload(
      { bridge, forecastService, now, cache },
      { date: "2026-04-29T00:00:00-05:00" },
    );
    nowMs += DEFAULT_AGENDA_TTL_MS + 1;
    await buildAgendaPayload(
      { bridge, forecastService, now, cache },
      { date: "2026-04-29T00:00:00-05:00" },
    );

    expect(bridge.readEvents).toHaveBeenCalledTimes(2);
  });
});

describe("buildAgendaPayload — input validation", () => {
  it("throws when date is unparseable", async () => {
    const bridge = { readEvents: vi.fn() };
    const forecastService = { get: vi.fn() };
    await expect(
      buildAgendaPayload(
        { bridge, forecastService, cache: new _AgendaCache() },
        { date: "not-a-date" },
      ),
    ).rejects.toThrow(/could not parse date/);
  });
});

// Suppress unused-import warning for ProjectId
void ProjectId;
