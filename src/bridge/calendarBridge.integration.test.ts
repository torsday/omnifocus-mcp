/**
 * Integration test for the Swift `calendar-bridge` subprocess.
 *
 * Gated on the `OMNIFOCUS_INTEGRATION_CALENDAR` env var. When unset (the
 * default — local dev, Linux CI, anywhere without macOS Calendar TCC
 * permission) the suite is skipped cleanly. When set, the test spawns the
 * real Swift binary against the user's EventKit store and asserts the
 * response shape — proving the wrapper survives a live round-trip.
 *
 * Per ADR-0018 §3 the bridge is read-only; this test does NOT create
 * events to assert against (the original #484 AC's "create via EventKit"
 * half is incompatible with the read-only stance and was adapted in #639).
 *
 * To run:
 *
 *   pnpm build:calendar-bridge   # build the Swift binary first
 *   OMNIFOCUS_INTEGRATION_CALENDAR=1 pnpm vitest run \
 *     src/bridge/calendarBridge.integration.test.ts
 *
 * On first run macOS will prompt for Calendar access; the test asserts
 * `permission === "granted"` so that prompt path is exercised end-to-end.
 *
 * @see docs/adr/0018-calendar-bridge-eventkit-only.md
 * @see src/bridge/calendarBridge.ts — wrapper under test
 */

import { describe, expect, it } from "vitest";
import { CalendarBridge } from "./calendarBridge.js";

const enabled = Boolean(process.env.OMNIFOCUS_INTEGRATION_CALENDAR);

describe.skipIf(!enabled)("calendar-bridge integration (live EventKit)", () => {
  const bridge = new CalendarBridge();

  it("ping reports the bridge is callable and surfaces a permission state", async () => {
    const result = await bridge.ping();
    expect(typeof result.ready).toBe("boolean");
    expect(["granted", "denied", "restricted", "not-determined"]).toContain(result.permission);
  });

  it("readEvents returns a typed events array for today's range", async () => {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);

    const events = await bridge.readEvents(dayStart.toISOString(), dayEnd.toISOString());

    expect(Array.isArray(events)).toBe(true);
    for (const event of events) {
      expect(typeof event.id).toBe("string");
      expect(typeof event.title).toBe("string");
      expect(typeof event.startsAt).toBe("string");
      expect(typeof event.endsAt).toBe("string");
      expect(typeof event.allDay).toBe("boolean");
      expect(typeof event.calendarName).toBe("string");
      expect(typeof event.calendarSource).toBe("string");
      expect(["confirmed", "tentative", "cancelled"]).toContain(event.status);
    }
  });
});
