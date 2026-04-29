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
 *
 * Output: one JSON line per invocation, written to stdout. Stderr receives
 * diagnostic messages (startup, errors). Stdout is strictly newline-delimited
 * JSON so the Node consumer never misparses.
 *
 * Subcommands:
 *
 *   ping        — health check + current authorization state. Read-only;
 *                 does NOT trigger the macOS Calendar TCC prompt.
 *   permission  — emit just the authorization state. Read-only; does NOT
 *                 trigger the prompt. Useful for the future Node-side
 *                 capability resource that surfaces `calendarAccess`
 *                 without forcing the user through TCC.
 *
 * `permission` values mirror EventKit's `EKAuthorizationStatus`:
 *   - "not-determined"  — never asked; calling EKEventStore.requestAccess
 *                          would trigger the TCC prompt (separate slice)
 *   - "denied"          — user denied; user must re-grant in System Settings
 *   - "restricted"      — denied at the OS level (parental controls, MDM)
 *   - "granted"         — permission granted; reads will succeed
 *
 * Subsequent slices of #484 add:
 *   - the `calendar` subcommand: read events in a [from, to] range
 *   - the `agenda` subcommand: merge calendar events with OF forecast data
 *   - explicit `requestAccess` flow that triggers the TCC prompt
 *
 * Lifecycle:
 *   - argv[1] = "ping"     → emit health + permission JSON, exit 0
 *   - argv[1] = "permission" → emit just permission JSON, exit 0
 *   - argv[1] = anything else → diagnostic on stderr, exit 1
 *   - argv[1] missing      → diagnostic on stderr, exit 1
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

case "":
    diagnostic("missing subcommand. Usage: calendar-bridge <subcommand>")
    diagnostic("subcommands: ping, permission")
    exit(1)

default:
    diagnostic("unknown subcommand: \(argv1)")
    diagnostic("subcommands: ping, permission")
    exit(1)
}
