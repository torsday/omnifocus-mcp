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
 *
 * `permission` values mirror EventKit's `EKAuthorizationStatus`:
 *   - "not-determined"  — never asked; `request-access` triggers the prompt
 *   - "denied"          — user denied; user must re-grant in System Settings
 *   - "restricted"      — denied at the OS level (parental controls, MDM)
 *   - "granted"         — permission granted; reads will succeed
 *
 * Subsequent slices of #484 add:
 *   - the `calendar` subcommand: read events in a [from, to] range
 *   - the `agenda` subcommand: merge calendar events with OF forecast data
 *
 * Lifecycle:
 *   - argv[1] = "ping"           → emit health + permission JSON, exit 0
 *   - argv[1] = "permission"     → emit just permission JSON, exit 0
 *   - argv[1] = "request-access" → trigger prompt (or return cached), exit 0
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

case "":
    diagnostic("missing subcommand. Usage: calendar-bridge <subcommand>")
    diagnostic("subcommands: ping, permission, request-access")
    exit(1)

default:
    diagnostic("unknown subcommand: \(argv1)")
    diagnostic("subcommands: ping, permission, request-access")
    exit(1)
}
