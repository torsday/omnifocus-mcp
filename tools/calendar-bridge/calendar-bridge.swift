/**
 * calendar-bridge — EventKit subprocess for the OmniFocus MCP server.
 *
 * Per ADR-0018, this binary is the seam between Node and macOS EventKit.
 * The Node process spawns it with a subcommand on argv[1] and parses
 * one JSON line on stdout.
 *
 *   $ calendar-bridge ping
 *   {"ready":false,"reason":"scaffold-only","permission":"not-determined"}
 *
 * Output: one JSON line per invocation, written to stdout. Stderr receives
 * diagnostic messages (startup, errors). Stdout is strictly newline-delimited
 * JSON so the Node consumer never misparses.
 *
 * This commit ships the **scaffold only** — no EventKit calls, no calendar
 * reads, no permission detection. The `ping` subcommand exists so the binary
 * can be smoke-tested end-to-end (build → invoke → parse JSON) before
 * EventKit integration lands. Subsequent slices of #484 add:
 *
 *   - permission-check against EKEventStore.authorizationStatus(for:)
 *   - the `calendar` subcommand: read events in a [from, to] range
 *   - the `agenda` subcommand: merge calendar events with OF forecast data
 *
 * Lifecycle:
 *   - argv[1] = "ping"     → emit scaffold JSON, exit 0
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

import Foundation

let args = CommandLine.arguments
let argv1 = args.count > 1 ? args[1] : ""

func emit(_ json: String) {
    print(json)
}

func diagnostic(_ message: String) {
    FileHandle.standardError.write("calendar-bridge: \(message)\n".data(using: .utf8) ?? Data())
}

switch argv1 {
case "ping":
    // Stable JSON shape — the Node consumer parses these keys directly.
    // Future slices replace `ready: false` with real permission state once
    // EventKit integration lands.
    emit(#"{"ready":false,"reason":"scaffold-only","permission":"not-determined"}"#)
    exit(0)

case "":
    diagnostic("missing subcommand. Usage: calendar-bridge <subcommand>")
    diagnostic("subcommands: ping (scaffold-only)")
    exit(1)

default:
    diagnostic("unknown subcommand: \(argv1)")
    diagnostic("subcommands: ping (scaffold-only)")
    exit(1)
}
