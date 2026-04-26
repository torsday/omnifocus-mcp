# ADR-0007: Dates are ISO-8601 with offset at the API boundary

**Date:** 2026-04-19
**Status:** Accepted

---

## Context

OmniFocus stores wall-clock timestamps in the user's local time zone. Internally, JXA hands us native `Date` objects; OmniJS gives us similar. The MCP boundary sees JSON, so whatever representation we choose becomes the stability contract with every client and every LLM agent.

Choices on the wire:

1. **Unix epoch millis** (`1713570000000`)
2. **ISO-8601 UTC** (`2026-04-19T17:00:00Z`)
3. **ISO-8601 local, no offset** (`2026-04-19T12:00:00`)
4. **ISO-8601 with offset** (`2026-04-19T12:00:00-05:00`)
5. **OmniFocus's own string format** (locale-formatted local time like `"Wed Apr 19 2026 at 12:00 PM"`)

The choice affects agent usability, debuggability, and round-trip fidelity across time zones and DST transitions. A wrong default here propagates into every tool that touches a date — which is most of them.

## Decision

All date/time values crossing the MCP boundary are **ISO-8601 with offset** (e.g. `2026-04-19T12:00:00-05:00`). Writes accept `Z` (UTC) or any offset; reads emit dates with the _user's current_ offset at query time.

- Any field whose name ends in `Date`, `At`, `Due`, `Defer`, `Reviewed`, or `Completed` follows this contract
- "No date" is `null`, not an empty string or sentinel
- The adapter layer translates to/from OF's local-time representation; the ISO contract is enforced at the service/adapter seam
- The timezone used for emission is resolved from the OS (`Intl.DateTimeFormat().resolvedOptions().timeZone`), overridable via `TZ` env var

## Options Considered

| Option | Pros | Cons |
| ------ | ---- | ---- |
| Unix epoch millis | Smallest; trivially sortable; unambiguous | Opaque to humans and LLMs — agents misinterpret timezones; hard to debug |
| ISO-8601 UTC (`Z`) | Unambiguous; sortable | Round-trip loses the user's local zone context; daily-review dates ("Thursday at 9am local") become confusing |
| ISO-8601 local, no offset | Matches OF's internal model; readable | Ambiguous at DST boundaries; clients can't tell what zone we mean |
| **ISO-8601 with offset** | Unambiguous; preserves user context; lexicographic sort still works; LLM agents handle natively | Slightly verbose; emission needs to query OS timezone |
| OF's own formatted string | Matches what OF shows the user | Not machine-parseable without locale awareness; fragile |

## Consequences

**Positive**

- Agents consume dates without guessing timezone — the offset is right there in the string
- Debugging logs are readable
- Lexicographic sort of ISO-8601 strings gives chronological order (within a zone; across zones the offset is present to disambiguate)
- Round-trip through the server preserves user zone context
- Matches what every widely-deployed API uses (Stripe, GitHub, AWS)

**Negative**

- Emission requires resolving the OS timezone at startup and on each date conversion
- Clients that want UTC must convert on their end (trivial)
- DST transitions mean the same wall-clock time has two offsets across fall back — we emit whichever is current at query time, which is the user-intuitive answer

**Risks**

- **Bare local time on input** (`"2026-04-19T12:00:00"`) is ambiguous. We **reject** such input with `ValidationError` rather than silently assume a zone. Mitigated by clear error message + suggestion.
- **Adapter leaks** — a date slipping through without conversion reaches the client as OF's weird string. Mitigated by domain schema validation at the adapter boundary: every date field is parsed through a strict ISO-8601-with-offset zod schema.
- **Host `TZ` change mid-session** — new dates reflect new zone. Acceptable; such changes are rare and user-initiated.

## References

- `DESIGN.md` §14 — date & time handling
- `SPEC.md` — non-functional requirements on compatibility and encoding
- RFC 3339 — ISO-8601 profile used by most web APIs
