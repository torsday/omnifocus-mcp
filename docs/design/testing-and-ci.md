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

Coverage is not enforced because it's gameable. Test *fidelity* is enforced at release time via Stryker mutation testing on a curated allowlist of high-value paths (`src/domain/`, `src/errors/`, `src/middleware/`, `src/server/`, tool input-validation schemas). The gate runs in `release.yml` between the bundle-size budget and the npm publish step; thresholds are calibrated to `baseline − 5` so the gate enforces non-regression. See [ADR-0017](../adr/0017-mutation-testing-release-gate.md).

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
- Bundle size budget: < 820 KiB (tsup --minify); above that blocks release. Bumped 500 → 525 → 540 → 580 → 610 → 625 → 640 → 660 → 680 → 700 → 740 → 760 → 780 → 800 → 820 KiB as the tool surface grew — per-tool string and Zod-schema overhead, plus inlined script payload, are the dominant bundle costs. The 800 → 820 KiB bump landed alongside [#773](https://github.com/torsday/omnifocus-mcp/issues/773) (fields[] projection on heavy read tools: projection.ts helper, per-domain field-name exports, per-tool wiring across the task/project/tag read surface — enables 30–70% payload reduction for bulk-triage callers). The 780 → 800 KiB bump landed alongside [#705](https://github.com/torsday/omnifocus-mcp/issues/705) (buildFolder shared JXA helper inlined into 4 consumers; reconciliation also adds the OF 4.8.8 sub-folder parentMap workaround uniformly to folder_get and folder_update). The 760 → 780 KiB bump landed alongside [#687](https://github.com/torsday/omnifocus-mcp/issues/687) (lookupOrThrow shared JXA helper inlined into 16 consumers per ADR-0020). The 740 → 760 KiB bump landed alongside [#686](https://github.com/torsday/omnifocus-mcp/issues/686) (DRY JXA scripts via build-time helper inlining per ADR-0020 — net source decrease of −1482 lines, but the canonical helper's docblock is inlined verbatim into 8 task-side consumers). The 700 → 740 KiB bump landed alongside [#689](https://github.com/torsday/omnifocus-mcp/issues/689) (ban-empty-catch annotated ~280 catch blocks across 32 JXA/OmniJS scripts). The 680 → 700 KiB bump landed alongside [#681](https://github.com/torsday/omnifocus-mcp/issues/681). The 660 → 680 KiB bump landed alongside slice 1 of [#483](https://github.com/torsday/omnifocus-mcp/issues/483) (webhooks: registry + register/list/delete tools + types + capability-resource integration + env-flag wiring per ADR-0016). The 640 → 660 KiB bump landed alongside slice 1 of [#485](https://github.com/torsday/omnifocus-mcp/issues/485) (decision-journal: decision_record + decision_clear tools, parser, read-side integration on get/get_many for both tasks and projects). The 625 → 640 KiB bump landed alongside the final slice of [#484](https://github.com/torsday/omnifocus-mcp/issues/484) (calendar + agenda — bridge wrapper, calendar resource, agenda merge module, AgendaItem union, capabilities probe). The 610 → 625 KiB bump landed alongside [#577](https://github.com/torsday/omnifocus-mcp/issues/577) (perspective_create + perspective_update added two OmniJS scripts inlined verbatim plus a recursive input rule schema). The 580 → 610 KiB bump landed alongside [#570](https://github.com/torsday/omnifocus-mcp/issues/570) (Example: sweep added ~7 KiB of description strings). Further bumps should NOT be flat increases: [#578](https://github.com/torsday/omnifocus-mcp/issues/578) tracks the tree-shaking / code-splitting investigation that should replace the next bump.

### Required status checks (branch protection on `main`)

Every PR must pass these CI contexts before merge — `gh pr merge --auto` waits for them, and `--auto` cannot race past a failure. Promoted from soft gates to required after [#647](https://github.com/torsday/omnifocus-mcp/issues/647), triggered by the [#644](https://github.com/torsday/omnifocus-mcp/pull/644) → [#645](https://github.com/torsday/omnifocus-mcp/issues/645) regression where `no-tool-counts` failed and the merge went through anyway.

| Context | What it gates | Source |
|---|---|---|
| `actionlint` | GitHub Actions workflow YAML correctness | `.github/workflows/meta-lint.yml` |
| `build (Node 24)` | `pnpm typecheck` + `pnpm test` + bundle size; the load-bearing test gate | `.github/workflows/ci.yml` |
| `lint` | biome + `pnpm lint` (covers nl-quality + docs:check + lint-custom) | `.github/workflows/ci.yml` |
| `nl-quality` | NL-quality lint per `docs/nl-quality-standards.md`, surfaced as PR annotations | `.github/workflows/meta-lint.yml` |
| `no-hosted-runners` | Forbids GitHub-hosted runners; this repo runs `[self-hosted, macos]` exclusively | `.github/workflows/meta-lint.yml` |
| `no-tool-counts` | Fails if any living doc restates the count of registered MCP tools (per [#478](https://github.com/torsday/omnifocus-mcp/issues/478)) | `.github/workflows/meta-lint.yml` |
| `pr` | PR shape (title format, label invariants) | `.github/workflows/pr-shape.yml` |
| `require-issue-link` | PR body contains `Closes #N` (or fix/resolve variants) so post-merge close-out can flip the issue | `.github/workflows/pr-link.yml` |
| `shellcheck` | Shell scripts under `scripts/` lint clean | `.github/workflows/meta-lint.yml` |

`strict` is intentionally `false` (PR branches don't need to be up-to-date with `main`) — that's friction for solo dev that buys nothing the rest of the gate set isn't already covering. `enforce_admins` is also `false` (admin override is a deliberate escape hatch, not a default gate).
