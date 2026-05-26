<!-- Originally DESIGN.md §§19–20 (split per #805) -->

# Testing strategy and CI/CD

## Testing strategy

Five tiers, each with a distinct purpose and gating.

| Tier               | Scope                                                                | Gating                            | Runs in CI |
| ------------------ | -------------------------------------------------------------------- | --------------------------------- | ---------- |
| **Unit**           | Services, domain schemas, utils — against `InMemoryAdapter`         | Always                            | Yes        |
| **Contract**       | Same behavior from every `OmniFocusAdapter` implementation           | Always for `InMemoryAdapter`; integration tier for `JxaTransport` / `OmniJsTransport` | Partial (unit portion) |
| **Script**         | Each JXA / OmniJS script in isolation — given input JSON, got output JSON | `OMNIFOCUS_INTEGRATION=1`   | On demand  |
| **Integration**    | Full adapter against a seeded live OF — per functional requirement    | `OMNIFOCUS_INTEGRATION=1`    | On demand / self-hosted runner |
| **End-to-end**     | Spawn MCP server, act as MCP client, exercise each tool               | `OMNIFOCUS_E2E=1`              | On tag release |

### Patterns

- **Property tests** for the repetition-rule schema, transport-text parser, and cursor codec (high edge-case density)
- **Chaos injection** for the transport layer: a test harness that simulates `OmniFocusNotRunning`, `PermissionDenied`, `Timeout`, and malformed-JSON-from-script
- **Snapshot tests** for tool descriptions (to catch accidental description drift that might confuse agents)
- **Seed fixture:** integration tests run against a reproducible OF database populated via `scripts/seed-integration-db.js` before each run
- **No network mocks** — there's no network to mock

### `InMemoryAdapter` contract scope

`InMemoryAdapter` is a **minimal test double, not a full OmniFocus simulator**. The contract tests it satisfies in the unit tier cover:

- CRUD on tasks, projects, tags, folders — field round-trip, ID uniqueness, parent-child relationships
- Filter application (by project, tag, flag, dates) — same filter semantics as JXA
- Basic error conditions — `NotFound` on unknown IDs, `ValidationError` on bad input

What `InMemoryAdapter` deliberately does **not** simulate:

- **Availability / blocked derivation** — `available` and `blocked` require the full task-graph reachability analysis OF performs internally. Tested in the integration tier only.
- **Cascade effects of recurring-task completion** — when you complete a task with a repetition rule, OF spawns the next occurrence. Replicating OF's logic for this is out of scope.
- **Perspective evaluation** — perspectives are OF's view engine; not modeled in-memory.
- **Sync, attachments, TaskPaper/OPML round-trips** — integration tier only.

Tests that need these behaviors run only against the `JxaTransport` / `OmniJsTransport` / `TransportRouter` implementations under `OMNIFOCUS_INTEGRATION=1`. This split is documented in `tests/README.md`.

### Coverage target

Not a percentage. The target is: **every error path in every service method is exercised**, and **every script has at least one integration test**. If a service has untested error paths, it blocks the milestone.

### Test fidelity (mutation testing)

Coverage is not enforced because it's gameable. Test *fidelity* is enforced at release time via Stryker mutation testing on a curated allowlist of high-value paths (`src/domain/`, `src/errors/`, `src/middleware/`, `src/server/`, tool input-validation schemas). The gate runs in `release.yml` after the test suite and before the npm publish step; thresholds are calibrated to `baseline − 5` so the gate enforces non-regression. See [ADR-0017](../adr/0017-mutation-testing-release-gate.md).

### Flaky-test quarantine ([#958](https://github.com/torsday/omnifocus-mcp/issues/958))

Tests that flake intermittently against the live-OmniFocus integration mount — cold-start JXA latency, sync timing, synthetic-ID collisions on a polluted runner — are quarantined via the `quarantineTest` helper at `tests/lib/quarantine.ts`. Quarantine is a triage tool, not a fix: it keeps the gating integration check honest while flake repairs land separately.

**To move a test into quarantine:**

1. Replace its `test("name", fn)` call with `quarantineTest("name", fn)`. The helper is a drop-in for `test`.
2. Add an inline comment above the call explaining what flakes (the failure mode and why it's confined to the integration mount).
3. File or reference the issue tracking the underlying repair.

The helper appends `[quarantine]` to the test name so reviewers scanning a CI log can immediately tell which failures are gating vs. informational.

**Behavior of quarantined tests:**

| Tier / script | Behavior |
|---|---|
| Unit (default `pnpm test`) | **Runs** — the same contract harness is also mounted against `InMemoryAdapter`, which has no flake confound; unit-tier coverage of the method is preserved. |
| Integration normal (`pnpm test:integration`) | **Skipped** — main check stays green when the reliable suite passes. |
| Integration quarantine (`pnpm test:integration:quarantine`) | **Runs**; the script tolerates non-zero exit so a real failure here is informational. Run locally to confirm repairs before promoting a test back to plain `test()`. |

**To graduate a test out of quarantine:**

1. Repair the underlying flake (fix the cold-start latency, sync-timing race, or test-design issue — whatever was identified in the tracking issue).
2. Run `pnpm test:integration:quarantine` locally and confirm the quarantined test now passes reliably.
3. Replace `quarantineTest(...)` with plain `test(...)` and drop the explanatory comment. The graduation happens in the same PR as the repair so the test rejoins the gate immediately.

---

## CI/CD

### Pipeline (GitHub Actions)

- **On every PR to `main`:**
  - macos-latest runner
  - Node 24
  - `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` (unit tier)
  - No integration / e2e
  - Must all pass to merge; `main` branch protection enforced
- **Integration workflow (`integration.yml`):**
  - Triggers: manual dispatch (`workflow_dispatch`), tag push, or pull_request to `main`
  - Runs on a self-hosted macOS runner with OmniFocus + seeded DB
  - `OMNIFOCUS_INTEGRATION=1 pnpm test:integration`
  - Fork PRs short-circuit the heavy job (forks lack self-hosted runner access by GitHub's security model); contributors run integration tests locally instead
  - `integration-gate` job (ubuntu-latest) is the stable required-check name in branch protection — fork skip is acceptable, canonical-repo skip is a failure (gap 2 of [#679](https://github.com/torsday/omnifocus-mcp/issues/679))
- **Release workflow (`release.yml`):**
  - Trigger: tag push `v*.*.*`
  - Reuses the PR pipeline + builds distribution
  - `pnpm publish --access public` to npm
  - Creates GitHub Release with auto-generated notes from `release_notes.md` prompt output

### Quality gates

- `pnpm typecheck` — zero errors
- `pnpm lint` — zero errors; biome config enforces `coding.md` standards
- `pnpm test` — zero failures; execution < 10s
- `pnpm build` — single-file bundle emitted to `dist/index.js`
- Bundle size: **informational only** as of [#910](https://github.com/torsday/omnifocus-mcp/issues/910). `scripts/check-bundle-size.sh` prints the size of `dist/index.js` on every CI run and emits a `::warning::` annotation when the bundle is above an 850 KiB soft threshold, but it does not block the build. The previous hard gate was bumped 15 times (500 → 850 KiB) without ever catching a real regression, while every bump cost a follow-up PR and blocked unrelated work in the meantime — for a Node 24 CLI distributed via npm + Homebrew at our current size, the cost of the gate exceeded its safety value. The soft warning preserves trend visibility and the path back to enforcement (a one-line revert flips `exit 0` to `exit 1`); the long-term tree-shaking / code-splitting work to recover headroom lives at [#578](https://github.com/torsday/omnifocus-mcp/issues/578) and [#827](https://github.com/torsday/omnifocus-mcp/issues/827).

### Required status checks (branch protection on `main`)

Every PR must pass these CI contexts before merge — `gh pr merge --auto` waits for them, and `--auto` cannot race past a failure. Promoted from soft gates to required after [#647](https://github.com/torsday/omnifocus-mcp/issues/647), triggered by the [#644](https://github.com/torsday/omnifocus-mcp/pull/644) → [#645](https://github.com/torsday/omnifocus-mcp/issues/645) regression where `no-tool-counts` failed and the merge went through anyway.

| Context | What it gates | Source |
|---|---|---|
| `actionlint` | GitHub Actions workflow YAML correctness | `.github/workflows/meta-lint.yml` |
| `build (Node 24)` | `pnpm typecheck` + `pnpm test` + bundle-size report (informational, never blocks); the load-bearing test gate | `.github/workflows/ci.yml` |
| `lint` | biome + `pnpm lint` (covers nl-quality + docs:check + lint-custom) | `.github/workflows/ci.yml` |
| `nl-quality` | NL-quality lint per `docs/nl-quality-standards.md`, surfaced as PR annotations | `.github/workflows/meta-lint.yml` |
| `no-hosted-runners` | Forbids GitHub-hosted runners; this repo runs `[self-hosted, macos]` exclusively | `.github/workflows/meta-lint.yml` |
| `no-tool-counts` | Fails if any living doc restates the count of registered MCP tools (per [#478](https://github.com/torsday/omnifocus-mcp/issues/478)) | `.github/workflows/meta-lint.yml` |
| `pr` | PR shape (title format, label invariants) | `.github/workflows/pr-shape.yml` |
| `require-issue-link` | PR body contains `Closes #N` (or fix/resolve variants) so post-merge close-out can flip the issue | `.github/workflows/pr-link.yml` |
| `shellcheck` | Shell scripts under `scripts/` lint clean | `.github/workflows/meta-lint.yml` |

`strict` is intentionally `false` (PR branches don't need to be up-to-date with `main`) — that's friction for solo dev that buys nothing the rest of the gate set isn't already covering. `enforce_admins` is also `false` (admin override is a deliberate escape hatch, not a default gate).

#### Informational gates (run, surface, don't block)

These checks run on every applicable PR but are configured with `continue-on-error: true` and are **not** in the branch-protection required list. Failures appear as warnings and a `::warning::` annotation; the merge is not blocked. After a clean soak week the gate is promoted by flipping `continue-on-error: false` and adding the check to the required list — this is the [#647](https://github.com/torsday/omnifocus-mcp/issues/647) CI promotion policy.

| Context | What it gates | Source |
|---|---|---|
| `jxa-tsc` | (1) Regen-drift on `src/scripts/jxa/_types/omnifocus.d.ts` vs `pnpm generate:jxa-types`; (2) `tsc` over the JXA scripts opted into `// @ts-check` (`tsconfig.jxa-tscheck.json`). Path-filtered to PRs touching `src/scripts/jxa/**`, `vendor/OmniFocus.sdef`, `scripts/generate-jxa-types.ts`, or `tsconfig.jxa-tscheck.json`. Beachhead landed in [#987](https://github.com/torsday/omnifocus-mcp/issues/987); the script-level rollout completed in [#989](https://github.com/torsday/omnifocus-mcp/issues/989) (all 61 consumer scripts opted in via slices 1–22). The job runs `continue-on-error: true` for now; promotion to required (branch-protection enforcement) is the remaining sub-task of #989 and is gated on a clean week. | `.github/workflows/meta-lint.yml` |
