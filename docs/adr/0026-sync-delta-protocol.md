# ADR-0026: `changes_since` sync-delta protocol with a prior-state snapshot store

**Date:** 2026-06-03
**Status:** Accepted (amended 2026-06-03, #1095 — `removed` added as opt-in)

---

## Context

[#819](https://github.com/torsday/omnifocus-mcp/issues/819) asked for field-level deltas so sync-style consumers stop re-fetching whole Task/Project records every poll (5–10× payload cut). The issue framed it as "change `changes_since` to return deltas," but that premise was stale:

- `changes_since` was **not** a public tool. `getChangesSince(sinceIso): {taskIds, projectIds}` is an internal adapter primitive (`OmniFocusAdapter.ts`) used only by the watcher's cache-invalidation path (`composition.ts`). It returns **IDs only**.
- Computing `{ id, changes: {field: newValue} }` needs the entity's **prior state**. OmniFocus's `modificationDate` says *that* an entity changed, not *what* — there is nowhere to read "the previous value" from.
- OmniFocus exposes **no deletion signal**: `getChangesSince` is `modificationDate`-based and cannot see deletes (a deleted object has no record to query). The original AC's `removed: TaskId[]` is infeasible without a full-ID reconciliation each call.

## Decision

Ship a **new public `changes_since` MCP tool** implementing a token-based incremental sync protocol, backed by a server-side prior-state snapshot store.

- **Token protocol.** First call (no token) returns every entity in `added` plus a `syncToken` and `reset: true` (a full snapshot). A subsequent call with that token returns `added` (entities new since the token) and `modified` (`{ id, changes }` field-level deltas), with a fresh token. An unknown/expired token yields `reset: true` full re-sync. `reset: true` always means "this is a full snapshot — (re)initialize from it," whether first-call or post-expiry; the consumer's action is identical, so the two aren't distinguished.
- **Prior-state store** (`src/state/syncSnapshotStore.ts`, modeled on `replayStore`): bounded (`MAX_SIZE` 8, hard oldest-eviction), TTL'd (10 min), in-memory, **non-persistent across restarts** (a reconnecting client gets a token miss → full re-sync). Each token stores the full record set it returned; the next delta diffs current state against it via `diffRecord` (`src/domain/diff.ts`).
- **Steady-state delta is cheap:** `getChangesSince(snapshot.issuedAtIso)` (the existing whose()-pushdown path, #789) yields a small changed-ID set; only those are fetched and diffed. The next snapshot is the prior one overlaid with the changed set — **no full re-scan** on the delta path (only on bootstrap/resync).
- **Deletions: opt-in via `includeRemoved` (amended #1095).** A removed entity has no `modificationDate` for `getChangesSince` to surface, so detecting it requires enumerating the current full state and reconciling against the prior snapshot's ID set (`removed = priorIds − currentIds`). This trades the cheap incremental fetch for a full scan, so it is **opt-in**: `includeRemoved: true` runs the reconciliation and returns `removed: { tasks, projects }`; the default delta path keeps the cheap `getChangesSince` fetch and omits `removed` entirely (absent ≠ "nothing deleted"). Originally deferred at ADR-acceptance time; added in #1095.

## Consequences

- Sync consumers poll cheaply: a one-field edit returns ~one `{id, changes}` entry instead of every record.
- **Memory tradeoff:** a snapshot is a full record set per active token. The small hard cap + TTL bound it; this is a session-scoped sync helper, not a general cache. A client that opens many concurrent sync sessions will evict older tokens (→ those get a full re-sync). Acceptable: real sync consumers hold one token at a time.
- **Token semantics are deliberately weak:** opaque, in-memory, ~10-min TTL, no cross-restart survival. Documented so consumers treat a miss as "re-sync," not an error.
- **`reset` over a new warning code.** Token-expiry is signaled by the `reset` data field, not a new `WARN_*` code — full-vs-incremental is part of the protocol contract, and this keeps the warning taxonomy (ADR-0011) stable.

### Alternatives considered

- **Modify the internal `getChangesSince` to return records** — rejected: it's a cache-invalidation primitive; the watcher needs IDs, and there was no public surface to change.
- **Client sends prior state back for diffing (stateless server)** — rejected: the client would re-upload full records, defeating the payload saving.
- **Implement `removed` via full-ID reconciliation on every call** — rejected as the *default*: it enumerates all IDs every poll (the cost the delta protocol exists to avoid). Instead offered as the **opt-in `includeRemoved`** path (#1095), so high-frequency pollers keep the cheap default and only deletion-sensitive consumers pay the scan. A future watcher-level deletion signal could make it cheap enough to be the default.
- **A new `WARN_SYNC_TOKEN_EXPIRED` code** — rejected: `reset` in the payload is the cleaner protocol-level signal and avoids taxonomy churn.
