<!-- Originally DESIGN.md §§13–14 (split per #805) -->

# IDs and date/time handling

## ID strategy

OmniFocus uses **persistent alphanumeric IDs** (e.g. `"gHqVKr3xAWo"`) that survive renames and restructures. Names are not unique, are editable, and drift — they cannot be identifiers.

### Design

- **At the API boundary:** IDs are opaque strings. Clients pass what we gave them; no parsing, no assumptions about format.
- **Inside the code:** IDs are _branded types_ so a `TaskId` cannot accidentally be used where a `ProjectId` is expected:
  ```typescript
  export type TaskId       = string & { readonly __brand: "TaskId" };
  export type ProjectId    = string & { readonly __brand: "ProjectId" };
  export type TagId        = string & { readonly __brand: "TagId" };
  export type FolderId     = string & { readonly __brand: "FolderId" };
  export type AttachmentId = string & { readonly __brand: "AttachmentId" };
  ```
- **Constructors** (`TaskId.of(s)`) validate that the string is non-empty and matches OF's ID shape (conservative regex). Zod schemas use `z.string().transform(...)` to produce branded values.
- **Lookup tools never accept names.** `task_get` takes an ID, not a name. Lookup-by-name is an explicit tool: `task_find_by_name` (ambiguous, documented).

### Why branded types (over plain strings)

Prevents the class of bug where a caller passes a `TagId` to `task_get` and the type system silently allows it. The cost is a small constructor boilerplate; the benefit is compile-time elimination of an entire bug class.

Recorded as **ADR-0008**.

---

## Date & time handling

OmniFocus stores wall-clock timestamps in the user's local time zone. At the MCP boundary we use **ISO-8601 with offset** (`2026-04-19T12:00:00-05:00`), never bare local time, never UTC without offset, never Unix epochs.

### Design

- **Inputs:** any field whose name ends in `Date`, `At`, `Due`, `Defer`, `Reviewed`, or `Completed` is ISO-8601 with offset on the way in. We accept UTC (`Z`) and offsets; we reject bare local (`2026-04-19T12:00:00`).
- **Outputs:** always ISO-8601 with the _user's current_ offset at the time of the query. If the user is `-05:00` today, all dates emerge as `-05:00`, even if they were stored during DST.
- **Null semantics:** "no date" is `null`, not an empty string or sentinel. An unset due date is `{ "due": null }`.
- **Ranges** (for filters): inclusive on both ends; `dueBefore: "2026-05-01T00:00:00-05:00"` matches due-at-midnight-local.
- **Timezone resolution:** we query the OS (`Intl.DateTimeFormat().resolvedOptions().timeZone`) at startup; users can override via `TZ` env var (Node respects this).
- **Adapter responsibility:** JXA scripts translate to/from OF's native `Date` objects using local wall-clock. The ISO-8601 contract ends at the adapter.

### Why ISO-8601 with offset

- Unambiguous across users and machines
- Agents (LLMs) handle ISO dates reliably; Unix epochs confuse them
- Offset preserved means no "which zone was this captured in?" mystery
- Sorting is lexicographic — cheap on both sides of the wire

Recorded as **ADR-0007**.

### Floating time zones

OmniFocus supports "floating" dates — times that follow the user as they travel across time zones rather than anchoring to a specific UTC moment. A 9 AM meeting set as floating reads as 9 AM in Tokyo and 9 AM in London.

Each date-bearing field (`deferDate`, `dueDate`) has a companion boolean: `deferDateFloating` / `dueDateFloating`.

**Representation contract:**
- When `true`, the field is present with value `true`.
- When `false` (or the date is not floating), the field is **omitted entirely** — not set to `false`. This keeps the domain type clean and avoids explicit-`undefined` confusion under `exactOptionalPropertyTypes`.

**Transport layer (JXA):**
- JXA cannot read per-date floating flags; the `Date` class in JXA does not expose `shouldUseFloatingTimeZone`.
- Read operations (`getTask`, `getProject`) return `deferDateFloating` / `dueDateFloating` as `undefined` / omitted for all tasks. This is a known transport limitation, not a bug.
- OmniJS (Omni Automation plug-in) does expose `Date.fromString(iso, floating)` and can set/read the flag, but that transport is not wired in this release.

**Write operations (create/update):**
- All MCP tools accept `deferDateFloating` and `dueDateFloating` as optional boolean inputs.
- The InMemoryAdapter fully round-trips these flags (used for testing).
- The JXA adapter passes the flag to the script, but the script-side support (`Date.fromString(iso, true)`) is documented as `notYetWired` pending OmniJS integration. JXA writes silently ignore the flag.

**Why keep the field if JXA can't read it?**
The schema, domain types, and tool contracts are forward-compatible. When OmniJS transport is added (or when OmniFocus exposes the flag via JXA), the field is already wired end-to-end — no breaking change required.
