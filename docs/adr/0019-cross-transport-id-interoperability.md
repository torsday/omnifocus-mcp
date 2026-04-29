# ADR-0019: Cross-transport ID interoperability — creates must return the persistent ID, not a transient JXA specifier

**Date:** 2026-04-29
**Status:** Accepted

---

## Context

[ADR-0002](./0002-omnifocus-transport-dual.md) commits us to a dual-transport adapter: JXA primary, OmniJS fallback, fronted by a single `OmniFocusAdapter`. [ADR-0008](./0008-ids-branded-opaque-strings.md) commits us to using OmniFocus's **persistent** ID as the only identifier at the API boundary, branded by kind in TypeScript (`TaskId`, `ProjectId`, `TagId`, `FolderId`).

The two ADRs implicitly assume a single ID namespace — that whatever string a JXA wrapper hands back is the same string that an OmniJS wrapper will accept on the next call. **That assumption broke under empirical investigation** (see [#680 spike](https://github.com/torsday/omnifocus-mcp/issues/680#issuecomment-4347829225)). When objects are created via the JXA-routed `createProject` / `createTask` path, the ID returned from the wrapper is a **transient specifier ID** that:

- Differs from the object's eventual persistent `id.primaryKey` (the value OmniJS sees);
- Never reconciles with the persistent ID, even after sync or delay;
- Works for subsequent JXA reads (because JXA's `byId` resolves the transient specifier internally);
- **Fails for subsequent OmniJS reads** with `NotFound: <kind> not found: <id>`.

Empirical data from probes against OmniFocus 4.x:

| Object source | JXA `obj.id()` | OmniJS `obj.id.primaryKey` | Interoperable? |
|---|---|---|---|
| Existing project (already in DB) | `btd6qGgG13A` | `btd6qGgG13A` | ✓ same value |
| Freshly-created via JXA `Project(props) + push()` | `psjVT7w-EMQ` | `ncEJuhGSRQQ` | ✗ different values |
| After 1s delay | `psjVT7w-EMQ` | `ncEJuhGSRQQ` | ✗ still different |
| Created via OmniJS `new Project(name)` | `h7CoVYPAK4s` | `h7CoVYPAK4s` | ✓ same value (round-trips) |

Real-world impact:

- The integration test suite has been red on every release tag from v1.0.0 through v1.2.0 — most failures are downstream of this single architectural mismatch (the rest are independent JXA quirks like the `containingProject().class()` issue closed in [#673](https://github.com/torsday/omnifocus-mcp/issues/673)).
- Any test or user code that does `createProject` (JXA-routed) → `moveTask` (OmniJS-routed) hits `NotFound` for a project that was just created and demonstrably exists.
- The `ProjectId` brand type provides no protection against this — both transports return values typed as `ProjectId`, but the values are not interchangeable.

ADR-0008 said "persistent OmniFocus ID" — but our JXA create path doesn't actually return one. The contract we wrote is the contract we want; the implementation didn't honor it.

Failing to decide now means every cross-transport scenario remains a latent bug, integration tests stay red, and every new tool that crosses transports has to discover this on its own.

## Decision

**Every transport's create path must return a persistent ID consumable by every other transport.** When a JXA-implemented create cannot natively produce one, the transport is responsible for translating before returning. Callers receive a single canonical persistent ID with the existing brand types, and any transport reading by that ID — including the same transport that just created it — must succeed.

Concretely:

1. **`createProject`, `createTask`, `createTag`, `createFolder` route through OmniJS.** OmniJS's `new Project(name)`, `new Task(parent, name)`, etc. produce objects whose `id.primaryKey` is interoperable with both transports. Routing creates through OmniJS sidesteps the JXA specifier-ID problem entirely.
2. **The OmniJS create scripts mirror the field-set surface that the JXA scripts currently expose.** No regression in input contract; only the return-value lineage changes. `Project(folderId, status, sequential, completionCriterion, deferDate, dueDate, estimatedMinutes, flagged, review fields, …)` — all set after `new Project(...)` via the OmniJS API.
3. **JXA stays primary for everything else** (reads, updates, list filters, completion, drop, delete, archive, etc.). For these, JXA's `flattenedX.byId(persistentId)` works correctly because the object is no longer "fresh" — its persistent ID and JXA-visible ID converge once it has been written to the database.
4. **`OmniFocusAdapter`'s contract is amended** to require: "Any ID returned by any method must be acceptable as input to any other method that takes that brand type, regardless of transport routing." This is the invariant a future contract test must enforce (see Consequences).

The approach mirrors how [ADR-0002](./0002-omnifocus-transport-dual.md) routes operations — operation-by-operation choice based on what each transport can do correctly, with the router opaque to services.

Rejected alternatives:

- **Translate at the JXA boundary.** Modify each JXA create script to call `evaluateJavascript` at the end and translate its transient ID to the OmniJS primaryKey before returning. Looks surgical (no transport-routing change), but it requires picking a translation key (most-recently-created-with-this-name? unique-sentinel-name?) — every option is either racy (multi-creator scenarios) or invasive (forcing a sentinel into user-facing fields). Rejected as fragile.
- **Make adapter callers pass an explicit transport hint.** Adds a parameter every caller forgets to set; defeats the abstraction that `TransportRouter` exists to provide. Rejected.
- **Wait for OmniFocus to fix JXA.** Anthropic's release cadence is decoupled from Omni's; relying on Omni to issue an OF 4.x point release that changes JXA's specifier-ID behavior is an indefinite block. Rejected.
- **Pre-create a placeholder, then translate.** Use OmniJS to create a sentinel `__transient_<uuid>` object first, get the primaryKey, then rename it via JXA to the user's intended name. Rejected — too many round-trips, easy to leak sentinels on failure.

## Consequences

**Positive:**

- Cross-transport calls become first-class. Test code (and user code) can freely mix `createProject` with OmniJS-routed `moveTask` / `reorderTask` / `duplicateTask` without surprise.
- The integration test cluster ([#680](https://github.com/torsday/omnifocus-mcp/issues/680), [#681](https://github.com/torsday/omnifocus-mcp/issues/681), and tail of [#682](https://github.com/torsday/omnifocus-mcp/issues/682)) becomes implementable as routine fixes — the architectural blocker dissolves.
- ADR-0008's promise ("the persistent ID is the boundary identifier") is finally honored in implementation.
- A natural lint / contract-test target emerges: assert that every brand-typed ID round-trips across both transports for the same object. Pairs with [#679](https://github.com/torsday/omnifocus-mcp/issues/679)'s testing-coverage gap work.

**Negative:**

- Every JXA create path becomes one OmniJS round-trip on the create call. OmniJS via `evaluateJavascript` is sub-second but not free; expect ~100-300 ms added to creates. For batch creates this multiplies — see follow-up note below.
- Implementation cost: writing OmniJS analogues of `project_create.js` (~150 lines) and `task_create.js` (~200 lines), plus matching wrappers in `OmniJsTransport`. `tag_create` and `folder_create` are simpler (~80 lines each). Routing-table updates and the contract test land alongside.
- The `task_batch_create` path needs to re-route too — and a single OmniJS execution can do many `new Task(...)` calls, so the per-create round-trip cost becomes per-batch. Net win on batch latency vs status quo.
- Two now-empty JXA create scripts (or scripts with reduced surface) — possible code-deletion sweep when the implementation lands.
- Bundle size: marginal; OmniJS scripts inline as strings.

**Risks accepted:**

- OmniJS's `new Project(name)` returns a project with default folder placement (the library root). The current JXA-routed `createProject` accepts a `folderId`. The OmniJS version must reproduce this — placing the project in the target folder before returning. Verified achievable: `library.byIdentifier(folderId).children.push(...)` works in OmniJS.
- OmniJS's `new Task(parent, name)` requires a parent (project, parent task, or `inbox`). The current JXA-routed `createTask` accepts both `projectId` and `parentId` (mutually exclusive) plus an inbox case. Mappable directly.

## Migration / sequencing

This ADR alone changes nothing. Implementation is tracked as:

- **[#680](https://github.com/torsday/omnifocus-mcp/issues/680)** — implements OmniJS `createTask` + routing change. Closes 7 integration-suite failures.
- **[#681](https://github.com/torsday/omnifocus-mcp/issues/681)** — implements OmniJS `createProject` + routing change. Closes 3 integration-suite failures.
- Likely follow-up — `createTag`, `createFolder`, `task_batch_create`, `project_batch_create` for completeness.
- Likely follow-up under [#679](https://github.com/torsday/omnifocus-mcp/issues/679) — contract test that asserts cross-transport ID round-trip for every brand type.

After #680 and #681 land, the `needs-design` label drops from both. They become routine implementation tickets.

## References

- [ADR-0002](./0002-omnifocus-transport-dual.md) — JXA + OmniJS dual transport
- [ADR-0008](./0008-ids-branded-opaque-strings.md) — IDs as branded opaque strings
- [Spike findings on #680](https://github.com/torsday/omnifocus-mcp/issues/680#issuecomment-4347829225) — the empirical evidence this ADR is built on
- [#673](https://github.com/torsday/omnifocus-mcp/issues/673) — already-merged fix for an unrelated JXA quirk (`containingProject().class()` throws); confirmed the integration cluster has *multiple* root causes, not one
- [#679](https://github.com/torsday/omnifocus-mcp/issues/679) — testing-coverage gap that lets bugs of this class go undetected
