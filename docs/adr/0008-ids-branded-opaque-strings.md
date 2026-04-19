# ADR-0008: IDs as branded opaque strings, never names

**Date:** 2026-04-19
**Status:** Accepted

---

## Context

OmniFocus assigns each object (task, project, tag, folder, attachment) a **persistent alphanumeric ID** (e.g. `"gHqVKr3xAWo"`) that survives renames, moves, completions, and sync. Names, by contrast, are:

- Not unique (two tasks can share a name)
- Editable (a name today is not the name tomorrow)
- Locale-sensitive (non-English names work differently through AppleScript vs OmniJS)

A v1 surface that accepts names as identifiers would be fragile, collision-prone, and a source of bugs the moment a user renames anything. Inside the code, passing a raw `string` for any ID risks silently mixing up task vs project vs tag identifiers — a compile-time-detectable class of bug.

## Decision

We will use **persistent OmniFocus IDs as the only identifier at the API boundary** (no names), and inside the code they will be **branded opaque string types** so the type system prevents cross-kind confusion.

```typescript
export type TaskId       = string & { readonly __brand: "TaskId" };
export type ProjectId    = string & { readonly __brand: "ProjectId" };
export type TagId        = string & { readonly __brand: "TagId" };
export type FolderId     = string & { readonly __brand: "FolderId" };
export type AttachmentId = string & { readonly __brand: "AttachmentId" };
```

Constructors validate the string is non-empty and matches OF's conservative ID shape. Zod schemas use `z.string().transform(...)` to produce branded values. Lookup by name is an explicit, disambiguated tool (`task_find_by_name`), not the default.

## Options Considered

| Option | Pros | Cons |
| ------ | ---- | ---- |
| Accept names or IDs interchangeably | Convenient for humans writing tools by hand | Silent collisions (two tasks same name); ambiguous semantics; fragile under rename |
| IDs only, plain strings | Simple; no type machinery | Zero compile-time protection against cross-kind mix-ups (`TagId` passed to `task_get`) |
| **IDs only, branded opaque types** | Compile-time protection against cross-kind use; API still takes plain strings; trivial runtime cost | Minor constructor boilerplate; TS-only benefit (not visible at the MCP wire) |
| Rich ID objects (e.g. `{ kind: "task", id: "..." }`) | Self-describing | Heavier wire format; every client must marshal; inconsistent with OF's own ID model |

## Consequences

**Positive**

- An entire class of bug ("wrong-kind ID used") is eliminated at compile time
- Services and adapters read naturally: `adapter.getTask(id: TaskId)` is self-documenting
- Clients at the MCP boundary still pass plain strings — no TypeScript leakage
- Lookup-by-name is opt-in and clearly marked as ambiguous, not the happy path

**Negative**

- One constructor per kind (e.g. `TaskId.of(s)`); boilerplate but tiny
- TypeScript-only benefit; JavaScript consumers of the library see plain strings

**Risks**

- **Branded types bypassed via `as TaskId` casts** — mitigated by code review and a lint rule that flags casts in domain/adapter code
- **OF changes its ID format** — unlikely; OF has used persistent IDs since OF 2. If they did, the branded constructor relaxes to match.
- **User pastes an ID from elsewhere** (wrong kind) — caught at runtime by the adapter (returns `NotFound`), not silently applied.

## References

- `DESIGN.md` §13 — ID strategy
- Project convention documented in `CLAUDE.md` — "IDs only, never names."
