/**
 * calendar-bridge — EventKit subprocess for the OmniFocus MCP server.
 *
 * Per ADR-0018, this binary is the seam between Node and macOS EventKit.
 * The Node process spawns it with a subcommand on argv[1] and parses
 * one JSON line on stdout.
 *
 *   $ calendar-bridge ping
 *   {"ready":false,"reason":"awaiting-resource-implementation","permission":"granted"}
 *   $ calendar-bridge permission
 *   {"permission":"granted"}
 *   $ calendar-bridge request-access
 *   {"granted":true,"permission":"granted"}
 *   $ calendar-bridge calendar 2026-04-29T00:00:00-05:00 2026-04-30T00:00:00-05:00
 *   {"events":[{"id":"...","title":"Standup","startsAt":"...","endsAt":"...",...}]}
 *
 * Output: one JSON line per invocation, written to stdout. Stderr receives
 * diagnostic messages (startup, errors). Stdout is strictly newline-delimited
 * JSON so the Node consumer never misparses.
 *
 * Subcommands:
 *
 *   ping           — health check + current authorization state. Read-only;
 *                    does NOT trigger the macOS Calendar TCC prompt.
 *   permission     — emit just the authorization state. Read-only; does NOT
 *                    trigger the prompt.
 *   request-access — request Calendar access. **Triggers the macOS TCC
 *                    prompt on first call** (when current state is
 *                    `not-determined`); subsequent calls return immediately
 *                    with the cached state. Async — the binary blocks on a
 *                    DispatchSemaphore until the EventKit completion handler
 *                    fires. Emits `{"granted": bool, "permission": "..."}`.
 *   calendar FROM TO — read events in a [FROM, TO] ISO-8601 range.
 *                    FROM and TO are ISO-8601 strings with offset (e.g.
 *                    `2026-04-29T00:00:00-05:00`). Refuses to read unless
 *                    permission is `granted`; emits a typed error JSON
 *                    `{"error": "permission-denied", "permission": "..."}`
 *                    otherwise. Optional env var
 *                    `OMNIFOCUS_CALENDAR_SOURCES` filters by calendar name
 *                    (comma-separated, substring match).
 *
 * `permission` values mirror EventKit's `EKAuthorizationStatus`:
 *   - "not-determined"  — never asked; `request-access` triggers the prompt
 *   - "denied"          — user denied; user must re-grant in System Settings
 *   - "restricted"      — denied at the OS level (parental controls, MDM)
 *   - "granted"         — permission granted; reads will succeed
 *
 * Subsequent slices of #484 add:
 *   - the `agenda` subcommand: merge calendar events with OF forecast data
 *   - Node-side `omnifocus://calendar` and `omnifocus://agenda` resources
 *
 * Lifecycle:
 *   - argv[1] = "ping"           → emit health + permission JSON, exit 0
 *   - argv[1] = "permission"     → emit just permission JSON, exit 0
 *   - argv[1] = "request-access" → trigger prompt (or return cached), exit 0
 *   - argv[1] = "calendar"       → read events; argv[2]/[3] = from/to ISO-8601
 *   - argv[1] = anything else    → diagnostic on stderr, exit 1
 *   - argv[1] missing            → diagnostic on stderr, exit 1
 *
 * Build:
 *   swiftc tools/calendar-bridge/calendar-bridge.swift -o bin/calendar-bridge-darwin-$(uname -m)
 *
 * @see docs/adr/0018-calendar-bridge-eventkit-only.md — architecture decision
 * @see scripts/build-calendar-bridge.sh — CI build script
 * @see tools/watcher/omnifocus-watcher.swift — sibling subprocess pattern
 */

import EventKit
import Foundation

let args = CommandLine.arguments
let argv1 = args.count > 1 ? args[1] : ""

func emit(_ json: String) {
    print(json)
}

func diagnostic(_ message: String) {
    FileHandle.standardError.write("calendar-bridge: \(message)\n".data(using: .utf8) ?? Data())
}

/// Map `EKAuthorizationStatus` to the wire-stable string the Node consumer
/// expects. `fullAccess` and `writeOnly` (macOS 14+) both map to `granted` for
/// our read-only purposes — we don't surface the distinction since this
/// bridge never writes (per ADR-0018 §3 read-only mutation policy).
func authorizationStatusString(_ status: EKAuthorizationStatus) -> String {
    switch status {
    case .notDetermined:
        return "not-determined"
    case .restricted:
        return "restricted"
    case .denied:
        return "denied"
    case .authorized, .fullAccess, .writeOnly:
        return "granted"
    @unknown default:
        return "not-determined"
    }
}

/// Trigger the macOS Calendar TCC prompt (or return cached state if already
/// answered) and emit the result. Uses `requestFullAccessToEvents` on
/// macOS 14+ and falls back to the deprecated `requestAccess(to:completion:)`
/// for older targets — both call the same TCC machinery underneath, so the
/// result is identical for our read-only use case.
///
/// The subprocess blocks on a `DispatchSemaphore` until the completion
/// handler fires, then exits. EventKit dispatches the callback on a
/// background thread, so we don't need a RunLoop pump — the semaphore is
/// sufficient to keep the main thread alive.
func requestAccessAndEmit() -> Never {
    let store = EKEventStore()
    let semaphore = DispatchSemaphore(value: 0)
    var grantedFlag = false

    let completion: (Bool, Error?) -> Void = { granted, error in
        grantedFlag = granted
        if let error = error {
            diagnostic("requestAccess error: \(error.localizedDescription)")
        }
        semaphore.signal()
    }

    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents(completion: completion)
    } else {
        store.requestAccess(to: .event, completion: completion)
    }

    semaphore.wait()

    // Re-query authorization status after the prompt resolves: `granted` is
    // the boolean result, but the EKAuthorizationStatus is the stable
    // surface we report alongside it.
    let resolved = authorizationStatusString(EKEventStore.authorizationStatus(for: .event))
    emit(#"{"granted":\#(grantedFlag),"permission":"\#(resolved)"}"#)
    exit(0)
}

/// JSON-string-escape arbitrary text for embedding inside our hand-rolled
/// JSON output. Covers backslash, double-quote, control characters, and
/// preserves UTF-8. Hand-rolled rather than pulling in JSONSerialization for
/// the whole event tree keeps the binary single-file and the output shape
/// trivial to inspect.
func jsonEscape(_ s: String) -> String {
    var out = ""
    out.reserveCapacity(s.count + 2)
    for scalar in s.unicodeScalars {
        switch scalar {
        case "\\": out += "\\\\"
        case "\"": out += "\\\""
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        case "\u{08}": out += "\\b"
        case "\u{0C}": out += "\\f"
        default:
            if scalar.value < 0x20 {
                out += String(format: "\\u%04x", scalar.value)
            } else {
                out.unicodeScalars.append(scalar)
            }
        }
    }
    return out
}

/// Format a `Date` as an ISO-8601 string with offset, e.g.
/// `2026-04-29T09:00:00-05:00`. Uses `.withInternetDateTime` so the result
/// matches the wire format the Node consumer already accepts elsewhere.
let isoFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withTimeZone]
    return f
}()

func formatISO(_ date: Date) -> String {
    return isoFormatter.string(from: date)
}

func parseISO(_ s: String) -> Date? {
    return isoFormatter.date(from: s)
}

/// Map `EKParticipantStatus` to the wire-stable status string. `confirmed`
/// is the default for events where the user is the organizer (no explicit
/// participant status); `tentative` and `cancelled` are the other shipped
/// values from #484's AC.
func eventStatusString(_ event: EKEvent) -> String {
    switch event.status {
    case .confirmed: return "confirmed"
    case .tentative: return "tentative"
    case .canceled: return "cancelled"
    case .none: return "confirmed"
    @unknown default: return "confirmed"
    }
}

/// Detect whether the running user is an attendee of the event (vs the
/// organizer). EventKit doesn't surface this directly; we check the
/// `attendees` collection for any entry where `isCurrentUser` is true.
/// Returns `nil` when there are no attendees (solo events) so the Node-side
/// payload can omit the field rather than emit `false` ambiguously.
func isAttendeeFlag(_ event: EKEvent) -> Bool? {
    guard let attendees = event.attendees, !attendees.isEmpty else {
        return nil
    }
    return attendees.contains(where: { $0.isCurrentUser })
}

/// Optional calendar-source filter from `OMNIFOCUS_CALENDAR_SOURCES`. The
/// env var is a comma-separated list of substrings; an event passes the
/// filter when its `calendar.title` contains any of them (case-insensitive).
/// An empty / missing env var disables the filter (all calendars match).
let calendarSourceFilter: [String] = {
    guard let raw = ProcessInfo.processInfo.environment["OMNIFOCUS_CALENDAR_SOURCES"],
          !raw.isEmpty else {
        return []
    }
    return raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
        .filter { !$0.isEmpty }
}()

func passesCalendarFilter(_ event: EKEvent) -> Bool {
    if calendarSourceFilter.isEmpty { return true }
    let needle = event.calendar.title.lowercased()
    return calendarSourceFilter.contains(where: { needle.contains($0) })
}

/// Render a single `EKEvent` as a JSON object (no trailing comma). Field
/// shape matches #484's AC exactly: id, title, startsAt, endsAt, allDay,
/// calendarName, calendarSource, location?, status, isAttendee?.
func renderEvent(_ event: EKEvent) -> String {
    var fields: [String] = []
    fields.append(#""id":"\#(jsonEscape(event.eventIdentifier ?? ""))""#)
    fields.append(#""title":"\#(jsonEscape(event.title ?? ""))""#)
    fields.append(#""startsAt":"\#(formatISO(event.startDate))""#)
    fields.append(#""endsAt":"\#(formatISO(event.endDate))""#)
    fields.append(#""allDay":\#(event.isAllDay)"#)
    fields.append(#""calendarName":"\#(jsonEscape(event.calendar.title))""#)
    fields.append(#""calendarSource":"\#(jsonEscape(event.calendar.source.title))""#)
    if let location = event.location, !location.isEmpty {
        fields.append(#""location":"\#(jsonEscape(location))""#)
    }
    fields.append(#""status":"\#(eventStatusString(event))""#)
    if let isAttendee = isAttendeeFlag(event) {
        fields.append(#""isAttendee":\#(isAttendee)"#)
    }
    return "{\(fields.joined(separator: ","))}"
}

func readCalendarAndEmit(from fromArg: String?, to toArg: String?) -> Never {
    // Argument validation FIRST: callers get clean error messages regardless
    // of TCC state. The permission state is already exposed via `permission`
    // and `ping`, so checking it here doesn't leak anything new.
    guard let fromStr = fromArg, let toStr = toArg else {
        diagnostic("calendar: missing FROM or TO argument")
        diagnostic("Usage: calendar-bridge calendar <from-iso8601> <to-iso8601>")
        exit(1)
    }
    guard let fromDate = parseISO(fromStr) else {
        diagnostic("calendar: could not parse FROM as ISO-8601-with-offset: \(fromStr)")
        exit(1)
    }
    guard let toDate = parseISO(toStr) else {
        diagnostic("calendar: could not parse TO as ISO-8601-with-offset: \(toStr)")
        exit(1)
    }
    if !(fromDate < toDate) {
        diagnostic("calendar: FROM must be strictly before TO (got from=\(fromStr) to=\(toStr))")
        exit(1)
    }

    // Permission gate: refuse to read unless the user has granted access.
    // Returns a typed error JSON the Node-side consumer can map to the
    // `CalendarPermissionDenied` error from ADR-0018 §4.
    let currentPermission = authorizationStatusString(EKEventStore.authorizationStatus(for: .event))
    if currentPermission != "granted" {
        emit(#"{"error":"permission-denied","permission":"\#(currentPermission)"}"#)
        exit(0)
    }

    let store = EKEventStore()
    // `predicateForEvents` queries across all calendars when the third arg
    // is nil; the source-name filter (env-var) is applied at the per-event
    // level after the predicate returns. EventKit's predicate doesn't
    // support source-name matching directly, so we filter post-fetch.
    let predicate = store.predicateForEvents(withStart: fromDate, end: toDate, calendars: nil)
    let events = store.events(matching: predicate).filter(passesCalendarFilter)

    let rendered = events.map(renderEvent).joined(separator: ",")
    emit(#"{"events":[\#(rendered)]}"#)
    exit(0)
}

let permission = authorizationStatusString(EKEventStore.authorizationStatus(for: .event))

switch argv1 {
case "ping":
    // Health check: report bridge readiness + current authorization state.
    // `ready` becomes `true` once the calendar/agenda subcommands ship; for
    // now the bridge is callable but the resources aren't wired up yet.
    let ready = false
    let reason = "awaiting-resource-implementation"
    emit(#"{"ready":\#(ready),"reason":"\#(reason)","permission":"\#(permission)"}"#)
    exit(0)

case "permission":
    emit(#"{"permission":"\#(permission)"}"#)
    exit(0)

case "request-access":
    requestAccessAndEmit()

case "calendar":
    let fromArg = args.count > 2 ? args[2] : nil
    let toArg = args.count > 3 ? args[3] : nil
    readCalendarAndEmit(from: fromArg, to: toArg)

case "":
    diagnostic("missing subcommand. Usage: calendar-bridge <subcommand>")
    diagnostic("subcommands: ping, permission, request-access, calendar")
    exit(1)

default:
    diagnostic("unknown subcommand: \(argv1)")
    diagnostic("subcommands: ping, permission, request-access, calendar")
    exit(1)
}
