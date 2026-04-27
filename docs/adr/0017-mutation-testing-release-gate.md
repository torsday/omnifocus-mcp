# ADR-0017: Mutation testing as a release-time hard gate

**Date:** 2026-04-26
**Status:** Accepted

---

## Context

Coverage is gameable; mutation testing is not. A 90% line-covered test suite can have entire branches whose assertions don't actually verify behaviour — a mutation that flips `>` to `>=` or deletes a statement still passes. Mutation testing addresses this directly: it mutates the source, runs the suite, and reports the survivors. A surviving mutant is unambiguous evidence that the tests don't pin down the behaviour the mutated line is responsible for.

This project already runs a five-tier test pyramid (DESIGN §19) and gates release on bundle size (DESIGN §20). Mutation testing is the missing rung: a check that the suite *itself* still has teeth before each release, not just on each commit. The decision is non-obvious along several axes:

1. **Tool** — Stryker is the canonical option for TS, but the choice deserves a written justification.
2. **Scope** — what gets mutated? The whole codebase including JXA scripts (which can't be reached from Node) is too noisy; a curated allowlist is required.
3. **Threshold** — what mutation score fails the release? Industry numbers (60–80) are guidance, not law; the right number depends on the equivalent-mutant rate of *this* codebase.
4. **Gate placement** — release-only? Per-PR? Each option has different rollback semantics and CI cost.
5. **Equivalent mutants** — Stryker generates mutants that don't change observable behaviour (algebraic identities, dead-store elimination); they always survive and pollute the score.
6. **Flakiness** — timeout-based mutations are non-deterministic; the gate must not become noise.
7. **CI cost** — full mutation runs are slow. Self-hosted `mac-local` softens but doesn't eliminate this.

If no decision is made: either we never enable mutation testing (forfeit the signal), or we enable it ad-hoc and learn the failure modes the hard way during a release attempt — neither is acceptable for a project where the npm-published artifact is the public surface (per ADR-0011).

This ADR is design-only. The implementation lands under [#502](https://github.com/torsday/omnifocus-mcp/issues/502).

## Decision

We adopt **Stryker** as the mutation-testing tool, **scoped to a curated allowlist** of high-value source paths, gated in **`release.yml`** between integration tests and the npm publish step, with **calibrated thresholds set to `baseline − 5`** so the gate enforces non-regression rather than improvement, and an explicit **equivalent-mutant management process** to keep the metric honest. The gate runs once per release, not per PR.

### 1. Tool: Stryker

`@stryker-mutator/core` + `@stryker-mutator/vitest-runner`.

Rationale:

- **TypeScript-native:** generates mutants directly from the source AST without a transpilation round-trip.
- **Vitest integration:** the project's test runner is Vitest (DESIGN §19); Stryker's Vitest runner reuses the existing config (vitest.config.ts), so mutation runs see the same setup, mocks, and fixtures as `pnpm test`.
- **Maturity:** active maintenance, established equivalent-mutant ignore patterns, HTML reporter, JSON output for CI parsing.
- **Workers:** out-of-process worker pool that scales to available cores — the only realistic path to running a meaningful mutation suite under a CI budget.

Alternatives recorded for completeness, not as live options: PIT (Java; N/A), mutmut (Python; N/A). No JS-ecosystem competitor is mature enough to displace Stryker as of this ADR's date.

### 2. Scope: curated allowlist

Mutation runs target **only** the following paths:

- `src/domain/**` — pure domain types and value objects; high-leverage, low equivalent-mutant rate
- `src/errors/**` — error taxonomy + helpers; behaviour is observable from every tool
- `src/middleware/**` — circuit-breaker, rate-limit, loop-detection, invocation-logging; load-bearing for every request
- `src/server/**` (handlers and registration) — the seam where every tool's input-validation runs
- Tool input-validation Zod schemas under `src/tools/*/schema.ts` (or equivalent path)

Explicitly **excluded** from mutation:

- `src/scripts/jxa/**` and `src/scripts/omnijs/**` — JXA / OmniJS scripts run inside OmniFocus; not reachable from Node, no Vitest path mutates them meaningfully. Coverage stays in the integration tier (DESIGN §19 tier 4).
- `src/adapter/**` — the transport router, JxaTransport, OmniJsTransport; tested at the integration boundary, not at the unit level. Mutating them produces survivors that the integration tier — which doesn't run under the mutation gate — would catch. Wrong tier.
- `src/prompts/**` — declarative prompt-template strings; mutation has no useful signal here.
- `src/resources/**.data.ts` — data-only files (lookup tables, pre-computed maps). Same rationale as prompts.

The allowlist is enforced via Stryker's `mutate` config option. New paths added to the allowlist are an ADR-supersede event (this ADR or a successor); silent expansion defeats the deliberate-bar property.

### 3. Thresholds: calibrated, baseline-anchored

Stryker uses three thresholds: `break` (release-fails), `low` (warn), `high` (badge-worthy). Industry guidance starts at 60 / 70 / 80, but those numbers presuppose a codebase Stryker already knows. **We commit to a calibration phase** in the implementation ticket:

1. Run Stryker unscoped (allowlist applied) on the current codebase tip.
2. Record the mutation score and the equivalent-mutant rate.
3. Set initial thresholds:
   - `break` = `baseline − 5`
   - `low` = `baseline − 2`
   - `high` = `baseline + 5` (aspirational; raising it is a deliberate quality bar)

Rationale for `baseline − 5`: the gate's job is to detect *regressions* in test fidelity, not to drive improvement. Setting `break` at the current score makes every flaky run a release-blocker; setting it 5 points below absorbs equivalent-mutant noise and timing variance while still catching real test-fidelity loss.

Improving the thresholds happens by **deliberate uplift** — a separate PR raises `break` after a sustained increase in the actual score, the same way ADR-0011 treats versioning as deliberate rather than accidental.

### 4. Gate placement: release.yml, post-integration, pre-publish

The mutation gate runs in `release.yml` (tag-triggered), in this order:

```
typecheck → lint → test → build → bundle-size budget →
mutation gate ← (new) →
extract release notes → npm publish → GitHub Release
```

Rationale:

- **After integration tests, before `pnpm publish`:** failure aborts publish, leaves the tag. Recovery is the same as the existing bundle-size gate: delete the tag, fix, re-trigger. This is a pattern the project already knows.
- **Not per-PR:** mutation runs are too slow (~10–15 min target on the self-hosted runner) to gate every PR without flooding contributor friction. PRs gate on correctness of the change; releases gate on correctness of the artifact. Different cadences, different gates.
- **Not per-tag in `release-please.yml`:** release-please's PR is a metadata operation (CHANGELOG + version bump). Running mutation against the release-PR branch instead of the tag means the artifact actually published can differ from the artifact that was mutation-tested — same anti-pattern as testing pre-merge but publishing post-merge. The tag is the artifact's identity; gate there.

The implementation extends `release.yml` with a step running on the self-hosted `mac-local` runner (already used by `integration.yml`), reusing the runner's pnpm cache and vitest config.

### 5. Equivalent mutants: curated, rationaled, reviewed

Equivalent mutants survive by definition; they would survive any test suite. Examples: re-arranging algebraic identities (`a + b` → `b + a`), dead-store mutations on intentional defensive copies, optional-chaining short-circuits where both branches are observably identical at the call site.

Management:

- A `stryker-equivalents.json` (or `.stryker.config.mjs` `ignorers` block) lists known-equivalent mutation locations.
- **Each entry MUST carry a one-line rationale** explaining why this mutation is observably equivalent. No bare entries.
- **Quarterly review** (or per-release if a release lands within the quarter): a maintainer audits the file and removes entries whose original rationale no longer holds.
- **No reflexive additions.** If a maintainer is tempted to add an entry to silence a survivor, the default action is to write the missing test. The entry is the last resort, not the first.

This file becomes the cheat sheet that defeats the gate if not policed; that's a known risk the review cadence addresses.

### 6. Flakiness: single retry, surfaced not silenced

Timeout-based mutations are inherently non-deterministic — a mutation that introduces a busy loop kills its own test by hitting the runner timeout, but only sometimes.

Policy:

- **One retry per surviving mutant.** Stryker's runner-level retry covers this; configure once, not per-mutation.
- **Retry-rate threshold = 5%.** If retries exceed 5% of total mutations in a run, the gate emits a **warning** (not a failure) flagging suite flakiness for separate investigation. Flakiness-driven gate failures damage trust in the gate; surfacing without blocking preserves the signal.
- **Timeout: 2× normal test timeout.** Test infrastructure already has a timeout; doubling it for mutation runs absorbs busy-loop mutations without false-positive surviving-mutant reports.

### 7. CI cost: 15-minute wall-clock budget

Target: **< 15 minutes** wall-clock on the self-hosted `mac-local` runner.

If exceeded, escape hatches in priority order:

1. **Shrink scope.** Removing `src/server/**` first if its mutation count dominates; second, dropping the Zod-schema entries.
2. **Parallelize.** Stryker's `concurrency` option scales to runner core count; default to `cpus - 1`.
3. **Move to a manual `release-prep` workflow.** A separate workflow (not blocking release) runs mutation testing on demand or via a release-prep PR; the release gate degrades to a warning. This is a fallback, not a starting position — the value of the gate is its automaticity.

Budget is enforced by the implementation ticket: if the calibration run exceeds 15 minutes, the response is escape hatch 1 or 2 *before* enabling the gate.

### 8. Reporting: HTML artifact + Release-body summary + `internal_status`

Three surfaces for the result, each with a different audience:

- **HTML report** archived as a workflow artifact (`mutation-report-${tag}.zip`) and uploaded to the GitHub Release page. The HTML is the maintainer's debugging tool when a release fails the gate; preserving it across runs is required for triage.
- **One-line summary in the GitHub Release body**, generated by the workflow: `Mutation score: 78.3% (3142 mutants killed / 3989 total · 12 survived · 23 timed out · 4 equivalents)`. This is the public, durable signal for downstream consumers reading the release notes.
- **`internal_status` exposes the last-known mutation score** alongside the existing build / version / OF-version fields, so a running server can self-report. This is the operator's surface for "is the deployed version actually well-tested?" without leaving the agent.

The score is not committed to the repo (no badge in README) — it floats on the most recent Release object. README-pinned scores rot.

### Examples

**Calibration phase output (illustrative):**

```
Stryker baseline run (allowlist applied)
─────────────────────────────────────────
Total mutants:        3989
  - Killed:           3142  (78.8%)
  - Survived:         12    (0.3%)
  - Timed out:        23    (0.6%)
  - No coverage:      812   (20.4%)
  - Equivalent:       0     (uncatalogued)

Mutation score (excluding equivalents): 78.8%

Proposed thresholds: break=73.8 / low=76.8 / high=83.8
```

**Release-body line on a passing release:**

```
Mutation score: 78.3% (3142 killed / 3989 total · 12 survived · 23 timed out · 4 equivalents)
Bundle size: 412 KB / 500 KB budget
```

**Release-body line on a failed release (gate aborted publish):**

```
RELEASE BLOCKED — mutation score 71.2% < break threshold 73.8%
See artifact mutation-report-v1.2.0.zip · 47 new survivors since v1.1.0 baseline
```

## Options Considered

| Option | Pros | Cons |
| --- | --- | --- |
| **Stryker, allowlist scope, release-time gate, calibrated thresholds (chosen)** | Real signal on suite fidelity; non-regression contract; cost-bounded; deliberate threshold raising | One more thing to maintain; equivalent-mutant culture is required to keep honest |
| **Per-PR mutation testing** | Catches test-fidelity regressions at the change site | 10–15 min per PR is a contributor-friction wall; noise overwhelms signal; gates the wrong frequency (PRs are about change-correctness; releases are about artifact-correctness) |
| **Coverage instead of mutation** | Free; already familiar | Gameable (assertion-free tests still hit lines); the discussion that produced this ADR explicitly rejects this. Coverage as an *additional* signal alongside mutation is fine; replacement is not |
| **Manual mutation-score review (no gate)** | Zero workflow churn; maintainer reads report carefully | Solo-maintainer project; "read carefully every release" doesn't survive a busy week. Without enforcement, the discipline lapses and the metric stops mattering. Automation is the bar |
| **Per-PR coverage-delta gate + release-time mutation** | Catches test gaps at the cheap tier and fidelity loss at the expensive tier | Two signals to maintain; coverage's gameability still renders the per-PR gate weaker than this ADR's path; deferred to a future ADR if it proves needed |
| **Whole-codebase mutation (no allowlist)** | Maximal coverage of the source | JXA scripts and adapter code dominate the run with low-signal survivors; equivalent-mutant rate skyrockets; budget blown |

## Consequences

**Positive**

- Test-fidelity regressions become release-blockers, not silent decay. The bar is enforced by the workflow rather than by maintainer vigilance.
- The bundle-size gate set the precedent for a publish-blocking quality gate; this ADR extends the pattern to a second axis (test fidelity) without inventing a new mechanism.
- Calibrated thresholds remove the "what number?" argument from every release. The number is observable; raising it is deliberate.
- `internal_status` exposing the score makes the metric visible at runtime — operators don't need to leave the server to know whether the deployed version was well-tested.
- Equivalent-mutant culture is documented up-front, not invented per release. The quarterly review cadence keeps the ignore file from becoming a hiding place.
- Allowlist scope keeps the budget realistic without sacrificing high-leverage paths.

**Negative**

- One more workflow step on the publish path. A flaky mutation run blocks a release; the retry policy plus warning-not-failure on retry-rate softens this but doesn't eliminate it.
- The `stryker-equivalents.json` review cadence is a recurring chore. If it slips, the file rots and the score drifts.
- Self-hosted runner dependency (`mac-local`) becomes load-bearing for releases. Already true for integration tests; the cost is a known one but worth restating.
- Stryker is one more tool in the dev dependency graph. ~50 MB of `node_modules` for a release-only workflow is acceptable, but it is non-zero.

**Risks**

- **Risk:** thresholds set too tight; releases block on noise. *Mitigation:* `baseline − 5` absorbs noise; the warning-not-failure retry-rate gate surfaces flakiness without blocking; the rollback procedure is the same as bundle-size.
- **Risk:** maintainers add `stryker-equivalents.json` entries reflexively to silence survivors. *Mitigation:* one-line rationale required; quarterly review; "write the test first" stated as the default. Lint-checkable later (entry without rationale fails) if drift is observed.
- **Risk:** mutation run exceeds 15 minutes; releases slow. *Mitigation:* escape hatches documented (shrink scope, parallelize, move to release-prep). The ADR pre-commits to the response so the implementation ticket doesn't have to renegotiate it.
- **Risk:** Stryker's TS support regresses or the Vitest runner falls behind. *Mitigation:* the dependency is dev-only; failure is contained to the release workflow, not the runtime artifact. A pinned-known-good version + dependabot PR for upgrades is sufficient.
- **Risk:** the score becomes a vanity metric — maintainers chase it instead of using it. *Mitigation:* calibrated thresholds explicitly refuse improvement-driven movement; `high` is aspirational, not enforced. The README pins no score; the score rots if not maintained, and that's fine.
- **Risk:** allowlist drift — paths quietly added during implementation. *Mitigation:* this ADR lists the allowlist; expansion requires a successor ADR. Lint-checkable later (the Stryker config diffed against the ADR allowlist) if drift is observed.

## References

- `docs/adr/0011-versioning-and-stability.md` — public-contract stability; mutation gate is the test-fidelity arm of that stability promise
- `docs/adr/0013-tool-response-envelope.md` — pure-function envelope helpers (`ok()` / `err()`); mutation testing rewards exactly this kind of pure code
- `DESIGN.md` §19 — five-tier test pyramid; mutation testing slots above unit + below integration in terms of run cost, gates at release time
- `DESIGN.md` §20 — CI/CD; bundle-size gate is the precedent this ADR extends
- `~/src/github.com/torsday/llm_prompts/coding.md` — Goldilocks testing standard; mutation testing is the metric that keeps Goldilocks honest
- [Issue #501](https://github.com/torsday/omnifocus-mcp/issues/501) — this ADR's tracking spike
- [Issue #502](https://github.com/torsday/omnifocus-mcp/issues/502) — implementation ticket; gates on this ADR being Accepted
- ADR-0016 — reserved for webhook delivery design ([#483](https://github.com/torsday/omnifocus-mcp/issues/483)); the numbering gap is intentional
