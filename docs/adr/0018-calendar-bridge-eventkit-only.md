# ADR-0018: Calendar bridge — EventKit only, Swift-binary subprocess

**Date:** 2026-04-27
**Status:** Accepted

---

## Context

The single most-asked-for cross-app capability for OmniFocus users is a merged daily view: what's on my calendar AND what does OF think I'm doing today? [#484](https://github.com/torsday/omnifocus-mcp/issues/484) tracks adding `omnifocus://calendar` and `omnifocus://agenda` resources that satisfy this. Before the implementation work begins, two architecture-level decisions need to be locked so the implementation isn't re-litigated mid-PR:

1. **Which calendar substrate?** macOS EventKit, direct third-party APIs (Google Calendar, Microsoft Graph, Fastmail), or both?
2. **How does Node reach EventKit?** Bundled Swift binary subprocess, JXA shim through Calendar.app's scripting dictionary, or a native Node module that links against the EventKit framework?

Both questions are decision-shaped, not exploration-shaped — the trade-offs are well-understood and the issue body for #484 already opinionates the answers. This ADR formalises the choice so future implementation slices (Swift binary build target, permission flow, the two resources) can proceed without re-arguing the architecture.

The decision is non-obvious along several axes:

1. **Scope discipline.** This MCP server is a window into OmniFocus running on the same machine. Is calendar in-scope at all? If yes, where does the boundary sit?
2. **Substrate choice.** EventKit is the OS-native store; third-party APIs each carry a credential model, OAuth flow, and operational surface that is meaningful to *not* take on.
3. **Implementation path.** Each of the three Node↔EventKit routes has a different cost in build complexity, install-time fragility, and feature ceiling.
4. **Read-vs-write.** EventKit supports event creation, RSVP updates, calendar-source mutations. Is any of that in-scope, or is the bridge strictly read-only?
5. **Permission model.** macOS Calendar access requires user consent; this is a TCC prompt, not a silent capability. The MCP server's existing OF Automation prompt sets a precedent for how this is surfaced.
6. **Cross-platform install.** The npm package is macOS-only at runtime by virtue of OmniFocus, but `npm install` on a Linux CI box for typecheck-only purposes must still succeed.

If no decision is made: the implementation work for #484 stalls indefinitely, or each implementation PR re-argues the basic shape and accumulates rework when the next contributor disagrees.

This ADR is design-only. The implementation lands across multiple slices of [#484](https://github.com/torsday/omnifocus-mcp/issues/484).

## Decision

We adopt **EventKit as the sole calendar substrate**, accessed via a **tiny Swift binary subprocess** bundled in `dist/`, **read-only**, with permission state surfaced through the existing capability resource and a typed `CalendarPermissionDenied` error mirroring the existing OF `PermissionDenied` shape.

Third-party calendar APIs (Google, Microsoft Graph, Fastmail) are **out of scope by principle** — they belong in separate calendar-specific MCP servers that an agent composes with this one at the agent layer.

### 1. Substrate: EventKit only

EventKit is the OS-native calendar store on macOS. Apple Calendar, Fantastical, BusyCal, and any properly-integrated Google/Exchange/Office 365 account all read from it. One backend covers ~95% of OmniFocus users without baking third-party API credentials into this server.

Users on web-only Google Calendar can either enable Google sync in macOS System Settings → Internet Accounts (one-time, ~30 seconds, populates the EventKit store automatically) or pair this server with a separate Google Calendar MCP server.

### 2. Implementation path: Swift binary subprocess

`dist/calendar-bridge` — a tiny single-purpose Swift binary, invoked via `child_process.spawn`, returning JSON on stdout. Same I/O contract as the existing JXA `osascript` boundary (see ADR-0002).

Estimated size: <100 lines of Swift, no third-party dependencies beyond EventKit.framework.

### 3. Mutation policy: read-only

No event creation, no RSVP updates, no calendar-source mutations. Calendar **reads** are in-scope; calendar **writes** are out of scope by the same principle as third-party API access — write operations on calendars belong in calendar-specific MCP servers, not in an OmniFocus-shaped one.

### 4. Permission: same-shape as OF Automation

First call triggers the macOS Calendar TCC prompt (same UX as the existing OF Automation prompt). On denial, the bridge surfaces a typed `CalendarPermissionDenied` error matching the existing `PermissionDenied` shape from ADR-0013. Permission state is introspectable via `internal_status` (adds `calendarAccess: "granted" | "denied" | "not-determined"`) and via `omnifocus://capabilities`.

### 5. Build: macOS-only build target, soft-fail on Linux

The Swift binary is built as part of `pnpm build` on macOS. On Linux (CI typecheck-only boxes), the build step detects the platform and skips the Swift compilation with a clear log message — `npm install` and `pnpm typecheck` still succeed. The runtime artifact is macOS-only by virtue of OmniFocus anyway; the install-time degradation is purely about not blocking a Linux contributor running `pnpm typecheck`.

### Examples

**`omnifocus://calendar?from=2026-04-27&to=2026-04-28` payload (illustrative):**

```json
{
  "events": [
    {
      "id": "evt_abc123",
      "title": "Standup",
      "startsAt": "2026-04-28T09:00:00-05:00",
      "endsAt": "2026-04-28T09:15:00-05:00",
      "allDay": false,
      "calendarName": "Work",
      "calendarSource": "Google Calendar (work@example.com)",
      "location": "Zoom",
      "status": "confirmed",
      "isAttendee": true
    }
  ]
}
```

**Permission-denied response shape (illustrative):**

```json
{
  "error": {
    "code": "CALENDAR_PERMISSION_DENIED",
    "message": "Calendar access is not granted. Run: tccutil reset Calendar com.example.omnifocus-mcp; then re-authorize in System Settings → Privacy & Security → Calendars.",
    "remediationClass": "user-action-required",
    "details": { "currentState": "denied" }
  },
  "meta": { "calendarAccess": "denied", ... }
}
```

## Options Considered

| Option | Pros | Cons |
| --- | --- | --- |
| **EventKit only via Swift binary subprocess (chosen)** | Native API; covers ~95% of users without credentials; one new build target; same I/O shape as existing JXA boundary; read-only keeps scope small; permission UX matches existing OF prompt | Swift toolchain build dependency on macOS; Linux install needs a soft-fail path; subprocess startup adds ~30–80 ms per call (acceptable; cached at 60 s TTL per the issue body) |
| **JXA shim via Calendar.app scripting** | Reuses existing JXA transport; no new build target | Calendar.app's AppleScript dictionary is shallower than EventKit — missing structured location, attendee list, calendar source. Falls back to "good enough until you actually need the missing fields"; the missing fields are exactly what an agenda surface needs |
| **Direct Node FFI to EventKit.framework** (e.g. `node-ffi-napi` or a custom napi addon) | No subprocess overhead; richest API access | Forces native module compile at install time; complicates `npm install` on Linux CI; npm-published binaries are platform-specific (multi-arch matrix); the build-and-publish complexity dominates the runtime savings |
| **Third-party calendar APIs (Google / Microsoft Graph / Fastmail) directly in this server** | Works for users without macOS Calendar sync configured | Each API has its own OAuth flow, credential storage, refresh-token model, rate-limit posture, and outage profile. Brings every calendar-vendor's API surface into this server's blast radius. Belongs in a separate MCP server composed at the agent layer |
| **Hybrid: EventKit + Google Calendar API** | Covers macOS-Calendar-syncing users and web-only Google users | Two code paths to maintain; the Google path needs OAuth and credential storage (see above). The user can always enable Google sync in macOS Internet Accounts (one-time ~30 s) or pair with a separate Google Calendar MCP server. The hybrid carries permanent maintenance cost for a one-time setup workaround |
| **Read + write to EventKit** | "Why not?" — adds event creation, RSVP, etc. | Calendar mutation is a different mental model than OmniFocus mutation; mistaken `event_create` calls have higher blast radius than mistaken `task_create` (calendar invites go to other people's inboxes); belongs in a calendar-specific MCP if anywhere. Read-only is a defensible scope line; "everything" is not |

## Consequences

**Positive**

- The implementation work for [#484](https://github.com/torsday/omnifocus-mcp/issues/484) can begin without re-arguing the architecture in each PR. The scope is locked: EventKit, Swift binary, read-only.
- Composability with other MCP servers is preserved as the design pattern. A user who wants direct Google Calendar access pairs this server with a Google Calendar MCP — the agent does the merging at its layer.
- The Swift-binary subprocess shape mirrors the existing JXA `osascript` boundary, so the failure modes (timeout, non-zero exit, malformed JSON, permission denied) reuse the existing transport patterns from ADR-0002 and the JxaTransport class.
- Permission UX matches the existing OF Automation prompt, so the user-facing model stays consistent ("the MCP server asks for access to one more macOS subsystem" — same shape every time).
- Read-only scope means there is no path through this server that can send a calendar invite, RSVP to one, or modify another user's calendar. The blast radius of any future bug is bounded.

**Negative**

- One more build target (`dist/calendar-bridge`) and one more language toolchain (Swift) on the contributor path. The build step needs a clean macOS-only / Linux-soft-fail split.
- Subprocess startup overhead per call (~30–80 ms estimated; needs verification during implementation). The 60 s cache TTL the issue body specifies absorbs this for repeated reads.
- Users on web-only Google Calendar must do the one-time macOS Internet Accounts setup or pair with a separate MCP server. We push the friction outward, which is correct, but it remains friction.
- TCC permission state is opaque to the npm install — the first-run UX will include a Calendar prompt that the user might not expect. The capability resource and `internal_status` surface make this introspectable, but the prompt itself is a TCC concern we don't control.

**Risks**

- **Risk:** Apple changes EventKit's permission model in a future macOS release (TCC reorganisation, scoped access, etc.) and the existing flow breaks. *Mitigation:* the bridge is a small Swift binary; updating it is a contained change. The capability resource surfaces the permission state so a degraded server is still introspectable.
- **Risk:** Swift toolchain availability on contributor machines is patchy (macOS Command Line Tools out of date, multiple Xcode versions installed). *Mitigation:* document the minimum Swift version in the implementation ticket; the build step detects and surfaces version mismatches with actionable guidance.
- **Risk:** EventKit's calendar-source naming is unstable across user accounts (Google sync renames itself, Exchange uses email addresses), making the optional `calendarSource` filter env var (`OMNIFOCUS_CALENDAR_SOURCES`) brittle. *Mitigation:* the filter accepts substring match, not exact match; the issue body specifies this.
- **Risk:** the Swift binary becomes a vector for supply-chain risk (binary checked into npm tarball, harder to audit than JS). *Mitigation:* the Swift source lives in-repo (`swift/calendar-bridge/`), the binary is reproducible from that source on macOS, and `npm view dist.attestations` covers it via Sigstore the same way the rest of the bundle is covered.
- **Risk:** the read-only scope line is questioned later ("just add `event_create`?"). *Mitigation:* this ADR documents the principle; expanding to write is an ADR-supersede event, not a silent feature add.

## References

- `docs/adr/0002-omnifocus-transport-dual.md` — JXA + OmniJS subprocess boundary; the Swift binary subprocess is the same shape pattern
- `docs/adr/0011-versioning-and-stability.md` — public-contract stability; new tools and resources are minor; the calendar resources are minor under that policy
- `docs/adr/0013-tool-response-envelope.md` — `ok()`/`err()` envelope; the calendar resources return `application/json` per DESIGN §28 (resources, not tools — no envelope wrapper)
- `DESIGN.md` §17 — lifecycle / cold-start budget; the Swift binary's startup overhead must respect the < 500 ms warm cold-start target
- `DESIGN.md` §28 — MCP resources; the calendar and agenda surfaces ship as resources, not tools
- [Issue #484](https://github.com/torsday/omnifocus-mcp/issues/484) — implementation ticket; gates on this ADR being Accepted
- [Issue #603](https://github.com/torsday/omnifocus-mcp/issues/603) — this ADR's tracking spike
- ADR-0016 — reserved for webhook delivery design ([#483](https://github.com/torsday/omnifocus-mcp/issues/483)); the numbering gap is intentional
