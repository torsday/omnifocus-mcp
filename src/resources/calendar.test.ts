/**
 * Unit tests for the `omnifocus://calendar{?from,to}` resource.
 *
 * The Swift bridge is stubbed via the injected `bridge.readEvents` so these
 * tests run on Linux CI without EventKit, without a built binary, and
 * without TCC permission.
 */

import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../bridge/calendarBridge.js";
import { CalendarPermissionDenied } from "../errors/index.js";
import {
  _CalendarCache,
  buildCalendarPayload,
  CALENDAR_URI_TEMPLATE,
  DEFAULT_CALENDAR_TTL_MS,
} from "./calendar.js";

const sampleEvent: CalendarEvent = {
  id: "abc",
  title: "Standup",
  startsAt: "2026-04-29T09:00:00-05:00",
  endsAt: "2026-04-29T09:30:00-05:00",
  allDay: false,
  calendarName: "Work",
  calendarSource: "iCloud",
  status: "confirmed",
};

describe("CALENDAR_URI_TEMPLATE", () => {
  it("uses RFC 6570 query expansion for from/to", () => {
    expect(CALENDAR_URI_TEMPLATE).toBe("omnifocus://calendar{?from,to}");
  });
});

describe("buildCalendarPayload — bridge call", () => {
  it("forwards explicit from/to to the bridge verbatim", async () => {
    const bridge = { readEvents: vi.fn().mockResolvedValue([sampleEvent]) };
    const result = await buildCalendarPayload(
      { bridge, cache: new _CalendarCache() },
      { from: "2026-04-29T00:00:00-05:00", to: "2026-04-30T00:00:00-05:00" },
    );

    expect(result).toEqual({ events: [sampleEvent] });
    expect(bridge.readEvents).toHaveBeenCalledWith(
      "2026-04-29T00:00:00-05:00",
      "2026-04-30T00:00:00-05:00",
      undefined,
    );
  });

  it("forwards the sources env value when provided", async () => {
    const bridge = { readEvents: vi.fn().mockResolvedValue([]) };
    await buildCalendarPayload(
      { bridge, sources: "Work,Personal", cache: new _CalendarCache() },
      { from: "2026-04-29T00:00:00-05:00", to: "2026-04-30T00:00:00-05:00" },
    );
    expect(bridge.readEvents).toHaveBeenCalledWith(
      "2026-04-29T00:00:00-05:00",
      "2026-04-30T00:00:00-05:00",
      "Work,Personal",
    );
  });

  it("propagates CalendarPermissionDenied unchanged", async () => {
    const bridge = {
      readEvents: vi.fn().mockRejectedValue(new CalendarPermissionDenied()),
    };
    await expect(
      buildCalendarPayload({ bridge, cache: new _CalendarCache() }, { from: "a", to: "b" }),
    ).rejects.toMatchObject({ code: "OF_CALENDAR_PERMISSION_DENIED" });
  });
});

describe("buildCalendarPayload — defaults", () => {
  it("defaults from/to to today's local-zone start/end when omitted", async () => {
    const bridge = { readEvents: vi.fn().mockResolvedValue([]) };
    const fixedNow = new Date("2026-04-29T15:30:00.000Z");
    await buildCalendarPayload({ bridge, now: () => fixedNow, cache: new _CalendarCache() });

    expect(bridge.readEvents).toHaveBeenCalledTimes(1);
    const call = bridge.readEvents.mock.calls[0] ?? [];
    const [from, to] = call as [string, string];

    // The exact ISO depends on the test runner's local TZ; assert structural
    // properties rather than a fixed string.
    const fromDate = new Date(from);
    const toDate = new Date(to);
    expect(fromDate.getHours()).toBe(0);
    expect(fromDate.getMinutes()).toBe(0);
    expect(toDate.getTime() - fromDate.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe("buildCalendarPayload — caching", () => {
  it("returns the cached payload within the TTL window without re-calling the bridge", async () => {
    const cache = new _CalendarCache();
    const bridge = { readEvents: vi.fn().mockResolvedValue([sampleEvent]) };
    let nowMs = 1_000_000_000_000;
    const now = () => new Date(nowMs);

    const first = await buildCalendarPayload({ bridge, now, cache }, { from: "a", to: "b" });
    nowMs += 30_000; // halfway through TTL
    const second = await buildCalendarPayload({ bridge, now, cache }, { from: "a", to: "b" });

    expect(first).toBe(second);
    expect(bridge.readEvents).toHaveBeenCalledTimes(1);
  });

  it("refetches when the TTL has elapsed", async () => {
    const cache = new _CalendarCache();
    const bridge = {
      readEvents: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([sampleEvent]),
    };
    let nowMs = 1_000_000_000_000;
    const now = () => new Date(nowMs);

    await buildCalendarPayload({ bridge, now, cache }, { from: "a", to: "b" });
    nowMs += DEFAULT_CALENDAR_TTL_MS + 1; // past TTL
    const second = await buildCalendarPayload({ bridge, now, cache }, { from: "a", to: "b" });

    expect(bridge.readEvents).toHaveBeenCalledTimes(2);
    expect(second.events).toEqual([sampleEvent]);
  });

  it("invalidates when the from/to changes", async () => {
    const cache = new _CalendarCache();
    const bridge = { readEvents: vi.fn().mockResolvedValue([]) };
    const now = () => new Date(1_000_000_000_000);

    await buildCalendarPayload({ bridge, now, cache }, { from: "a", to: "b" });
    await buildCalendarPayload({ bridge, now, cache }, { from: "a", to: "c" });

    expect(bridge.readEvents).toHaveBeenCalledTimes(2);
  });

  it("invalidates when the sources env value changes", async () => {
    const cache = new _CalendarCache();
    const bridge = { readEvents: vi.fn().mockResolvedValue([]) };
    const now = () => new Date(1_000_000_000_000);

    await buildCalendarPayload({ bridge, sources: "Work", now, cache }, { from: "a", to: "b" });
    await buildCalendarPayload({ bridge, sources: "Personal", now, cache }, { from: "a", to: "b" });

    expect(bridge.readEvents).toHaveBeenCalledTimes(2);
  });
});
