# ADR-0014: E2E harness uses an in-memory adapter switch

**Date:** 2026-04-24
**Status:** Accepted

---

## Context

The E2E tier (DESIGN §19, tier 5) gates on `OMNIFOCUS_E2E=1`, spawns the bundled `dist/index.js` as a subprocess, and acts as an MCP client over stdio. Issue #80 sets the bar at "every registered tool is invoked at least once" with a valid `ToolEnvelope` response. Today the smoke test (`tests/e2e/smoke.test.ts`) only invokes a handful of pure tools (`internal_status`, `task_parse_transport_text`) plus prompt and resource listings. The remaining 65+ tools all touch the JXA / OmniJS transports through `composeAdapter(config)`, which today returns the live `TransportRouter`. Without a live OmniFocus and macOS Automation permission, those calls throw before any MCP-layer assertion can run.

Three architectural options exist for closing the gap. Choosing one is hard to reverse — it determines harness shape, CI footprint, what bug classes we catch on every push, and how `composeAdapter` is structured.

If no decision is made, #80 stays blocked indefinitely and we ship without per-tool E2E coverage — leaving the registration / middleware / envelope plumbing untested at the integration boundary.

## Decision

We will **introduce an in-memory adapter switch** (`OMNIFOCUS_E2E_USE_MEMORY=1`) that causes `composeAdapter` to return the existing `InMemoryAdapter` (under a TransportRouter facade) instead of the live JXA + OmniJS chain. The E2E suite under `OMNIFOCUS_E2E=1` sets this flag on the spawned subprocess and asserts a valid `ToolEnvelope` for every registered tool.

The existing `OMNIFOCUS_INTEGRATION=1` integration tier on the `mac-local` self-hosted runner (DESIGN §19, tier 4) is **retained, unchanged, as the complementary live-OF suite** — it covers transport-specific bugs the in-memory adapter cannot model (availability/blocked derivation, recurring-task cascades, perspectives, sync, attachments, TaskPaper/OPML round-trips; see DESIGN §19 "InMemoryAdapter contract scope").

Option C — error-envelope-shape-only assertions — is rejected.

## Options Considered

| Option                                        | Pros                                                                                                                                                                                                                                                                                                                                                                                                | Cons                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. In-memory adapter switch** (chosen)      | Runs on every push (any GitHub-hosted runner, no Automation permission). Deterministic — no flaky live OF. Reuses the `InMemoryAdapter` already validated by 48 contract tests in `tests/contract/inMemory.contract.test.ts`. Exercises the *real* `McpServer` plumbing — registration, middleware composition (#291), invocation logging (#283), envelope shape (ADR-0013), stdio transport (ADR-0010). One-time wiring change in `composeAdapter`. | Doesn't catch JXA / OmniJS-specific bugs (the `.make()` family at #279 / #280 / #281 are exactly this class). Mitigated because tier 4 already covers them. The `InMemoryAdapter` doesn't model availability/blocked, recurring cascades, perspectives, sync, attachments — tools whose acceptance hinges on those will exercise the harness path but assert weaker post-conditions. |
| **B. Live-OF-only (mac-local + seed fixture)** | Hits the real transport stack. Catches the JXA / OmniJS bug classes A misses. Already partly built: `integration.yml` exists.                                                                                                                                                                                                                                                                       | Only runs on the self-hosted `mac-local` runner. Requires Automation permission + a deterministic seed fixture (`scripts/seed-integration-db.js` per DESIGN §19; not yet built). Slower; flakier under permission revocation. The "every tool on every push" property is unattainable.                                                                  |
| **C. Error-envelope shape only**              | Trivial harness; no `composeAdapter` change.                                                                                                                                                                                                                                                                                                                                                       | Weak signal. A regression that breaks every handler in the same way (e.g. middleware misuse, envelope drift) reports green because every error envelope is structurally valid. Doesn't satisfy #80's intent — "invoked" without a meaningful post-condition is theatre.                                                                                  |

## Consequences

**Positive**

- Per-tool E2E coverage runs on every push: the registration manifest (80 tools, sourced from `ALL_TOOL_DESCRIPTIONS`) cannot drift from the boot path without a test failure.
- Middleware composition (assertNotShuttingDown → circuit-breaker → rate-limit → loop-detection → invocation-logging) is exercised end-to-end in CI, not just in unit tests against the inner stack.
- The `InMemoryAdapter` is preserved as a load-bearing seam — increases the value of every contract test that already targets it.
- Cold-start budget (`< 500ms`, DESIGN §17) is meaningfully testable on every push: in-memory paths complete fast enough that a regression in startup cost surfaces at PR time, not release time.
- A deterministic E2E suite makes #284 (first npm publish) safer: the release workflow can re-run E2E on the published artifact.

**Negative**

- `composeAdapter`'s seam grows a third branch (live / raw-script-allowed / in-memory). Manageable — the new branch is one early `if`.
- Some tools (perspective_evaluate, sync_trigger, attachment_*, export_taskpaper round-trip) cannot assert meaningful behaviour against the in-memory adapter — they degrade to "envelope is valid" assertions in the E2E tier, with the real coverage staying in tier 4. We accept this and document it inline at each tool's E2E case.
- The in-memory adapter must continue to satisfy the `OmniFocusAdapter` contract for *every* method the boot path touches, including methods that today raise `NotYetWired`. Any new method added to the interface must land an in-memory implementation in the same PR or the E2E suite fails. This is the intended forcing function.

**Risks**

- *Risk: contract drift.* The in-memory adapter's behaviour silently diverges from JXA's. *Mitigation:* the existing tier 2 contract tests (`tests/contract/inMemory.contract.test.ts`) already pin behaviour for shared methods, and tier 4 catches the remainder on `mac-local`. Tier 5 is now the third independent check across the same surface.
- *Risk: false confidence.* Operators read "E2E green" as "production-ready," when in-memory only proves the wrapper plumbing. *Mitigation:* the E2E test summary explicitly distinguishes "in-memory tier" from "live-OF tier" in its log line; `internal_status` carries the active transport name through to the response envelope (`meta.transport`), so any green run records which backend it ran against.
- *Risk: in-memory tier crowding out tier 4.* Once the in-memory tier exists, there's pressure to skip the slower live tier. *Mitigation:* tier 4 stays gated on its own env var (`OMNIFOCUS_INTEGRATION=1`) and its own workflow (`integration.yml` on `mac-local`). The two tiers are independent gates; release prep requires both green.

## Implementation outline

In #80 (the implementing issue), the wiring lands in three small steps:

1. **`composeAdapter` switch.** Read `OMNIFOCUS_E2E_USE_MEMORY` (or a config-derived flag) at the top of `composeAdapter(config)`; when set, return the existing `InMemoryAdapter` wrapped in the same `TransportRouter` shape. Type-level the change is invisible to callers — `OmniFocusAdapter` is the contract.
2. **Harness flag.** `tests/e2e/E2EServer.ts` adds `OMNIFOCUS_E2E_USE_MEMORY=1` to the spawned subprocess `env` (alongside the existing `OMNIFOCUS_E2E=1`).
3. **Per-tool cases.** A single per-tool table in `tests/e2e/per-tool.test.ts` enumerates every registered tool (sourced from `listTools()` so the test follows the manifest), supplies minimal valid arguments, and asserts the response is a valid `ToolEnvelope` (success or typed error). Tools that cannot be meaningfully exercised against the in-memory adapter receive a documented `// degrades to: envelope-shape-only against in-memory` comment.

## References

- Issue #80 — E2E harness exercising every tool (the implementing ticket)
- Issue #316 — needs-design ticket that surfaced this decision
- DESIGN.md §6.1 — adapter-as-critical-seam invariant; the precondition that makes Option A possible
- DESIGN.md §19 — testing strategy (five tiers); this ADR places tier 5 atop the in-memory backend
- ADR-0002 — JXA + OmniJS dual transport (the live chain Option A swaps out for E2E only)
- ADR-0010 — stdio as sole MCP transport (preserved by all three options)
- ADR-0013 — uniform tool response envelope (the contract the E2E suite asserts)
- `tests/contract/inMemory.contract.test.ts` — the 48 contract tests that gate the InMemoryAdapter against the same surface JxaTransport implements
