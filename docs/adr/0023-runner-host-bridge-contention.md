# ADR-0023: Self-hosted runner shares OmniFocus with active MCP clients — accept temporal isolation; defer dedicated runner

**Date:** 2026-05-14
**Status:** Accepted

---

## Context

The self-hosted macOS runner (`mac-local` / `macos-omnifocus`) is the maintainer's daily-driver laptop. It runs both the integration suite (via `actions-runner`) and the maintainer's interactive Claude clients (Desktop, Code, etc.). Each Claude client spawns its own `@torsday/omnifocus-mcp` server via `npx`; each server periodically polls `changes_since` and other read operations against the same OmniFocus database the integration tests need.

OmniFocus's JXA bridge is **single-threaded** — one `osascript -l JavaScript` invocation in flight at a time. When 5+ concurrent MCP servers are running (the maintainer's normal "I'm working with Claude today" baseline), the bridge queues calls. Integration tests on the runner cannot get a `task_list` or seed-script through within the seed script's 60-second `osascript` timeout.

This was first surfaced as the v1.5.2 release-pipeline failure (2026-05-10 → 11), traced in detail in [#932](https://github.com/torsday/omnifocus-mcp/issues/932):

- `release.yml` ran `release-please` polish + merge; Stryker passed (25m41s, within the 35-minute cap).
- `integration-gate` failed at the `Seed integration fixtures` step: `ERROR: Seed script failed: osascript spawn failed: spawnSync osascript ETIMEDOUT`.
- Local reproduction on the runner host (`node scripts/seed-integration-db.js --clean`) also timed out at 60s while ~32 osascript processes from active MCP clients held the bridge.
- The 32 osascript processes were not orphans — they were the user's actual MCP clients' children. SIGKILLing them would have broken the active Claude sessions.

Prior work along this fault line:

- [#914](https://github.com/torsday/omnifocus-mcp/issues/914) — per-test project namespaces (test-level isolation against shared OF).
- [#928](https://github.com/torsday/omnifocus-mcp/issues/928) — job-started runner hook (state reset).
- [#929](https://github.com/torsday/omnifocus-mcp/issues/929) / [#930](https://github.com/torsday/omnifocus-mcp/issues/930) — workflow-level `--clean` flag for the seed script.
- [#933](https://github.com/torsday/omnifocus-mcp/pull/933) — soft-fail `integration-gate` in `release.yml` until this ADR lands.

Each is still right and shipped, but none addresses the root cause: **the runner host cannot reliably run integration tests while normal-load MCP clients hold the JXA bridge.** Integration tests, by design, assume exclusive access to OmniFocus.

This ADR commits the direction.

## Decision

**Accept temporal isolation (Option A) as the codified policy.** Codify it as a one-step pre-flight on the maintainer's `release` and `integration-run` flows that counts active osascript processes and warns when the bridge is busy. Defer Options B and C as parking-ticket follow-ups, to be reopened if the heuristic proves insufficient.

Concretely:

1. **Codify off-hours releases** as project policy in `.claude/commands/release.md` — release-please polish + merge happens when no interactive Claude clients are running. Open the release-please PR any time; merge it during low-load windows (early morning, or after explicitly quitting active Claude clients).
2. **Add a bridge-busy pre-flight** to `scripts/seed-integration-db.js` and to the `release` flow. If `pgrep -f "osascript -l JavaScript"` returns more than a small threshold (default: 3 processes — enough headroom for the runner's own scripts), warn loudly and abort with a hint. The maintainer can override with `--force` after manually verifying the bridge is theirs to use.
3. **Soft-fail `integration-gate` in `release.yml` remains in place** (per #933) until the pre-flight + heuristic is proven over ≥ 4 successful releases. Then re-tighten to required.
4. **Documentation** — name the failure mode in `AGENTS.md` ("CI status — current known issues") and `docs/runner-setup.md` ("JXA bridge contention with concurrent MCP clients") so any future contributor or LLM operator has a name and a pointer.

## Options Considered

| Option | Pros | Cons |
|---|---|---|
| **(A) Temporal isolation — release during low-load windows, with a bridge-busy pre-flight** *(chosen)* | Zero hardware cost. Codifies what the maintainer already does implicitly. The pre-flight makes the failure mode visible *before* a release attempt, not after a 25-minute Stryker run. Reversible. | Relies on the maintainer's calendar discipline. Doesn't scale beyond a single-developer project. The pre-flight is heuristic, not enforced — `--force` is always available. |
| **(B) Bridge throttling — `OMNIFOCUS_BRIDGE_QUIESCE` env flag on the maintainer's daily-driver MCP servers, with a CI-LOCK signal file or OF-side fixture task** | Cooperative throttling preserves both live MCP clients and CI. Could let releases proceed during active sessions if all clients respect the flag. | Significant coordination code: every MCP server instance must poll for the CI-LOCK signal and pause its bridge calls. Cooperative-not-enforced: a forgotten env var or a fresh Claude client started mid-release bypasses it. Adds latency to live tool calls during the CI window. Not worth the implementation cost while Option A is sufficient. |
| **(C) Dedicated runner — separate macOS machine (Mac Mini or VM) with its own OmniFocus install used exclusively for CI** | The architecturally clean fix. Guaranteed exclusive bridge access. CI reliability independent of human activity. Maintainer's daily-driver OmniFocus is untouched, removing a small privacy concern (CI workflows see real personal data today). Scales with the project. | Hardware capital cost (Mac Mini ≈ $600+, plus OmniFocus license, plus ongoing maintenance). Not justified for a single-developer project with a weekly release cadence. No GitHub-hosted macOS runner ships OmniFocus; rented-mac-CI services likewise. Keep as a parking ticket — revisit if the project gains contributors, ships daily, or shifts to a paid runner budget. |
| **(D) Drop the integration suite from `release.yml`'s required-check set permanently** | Trivial. Releases stop being CI-gated by the contention. | Forfeits the integration suite's value as a pre-release safety net. The suite catches real JXA regressions ([#679](https://github.com/torsday/omnifocus-mcp/issues/679) listed three concrete bugs that shipped because the gap existed). Soft-failing temporarily (Option A's plan) is acceptable; making it permanent is not. |

## Consequences

### Positive

- **Releases stop failing on this fault line.** The maintainer either releases at off-hours or sees the pre-flight warning and waits. Either way, the v1.5.2-style 25-minute-Stryker-then-fail loop is gone.
- **A name for the failure mode.** Future bug reports, LLM agents reading the repo, and the maintainer's future self can identify "JXA bridge contention" by name. The contributing factors in [#932](https://github.com/torsday/omnifocus-mcp/issues/932) (mis-diagnosed three separate times before the root cause surfaced) won't recur.
- **No code change to the MCP server.** The fix lives in tooling (`.claude/commands/release.md`, `scripts/seed-integration-db.js`'s pre-flight, docs). Risk of regression to the shipped surface is zero.
- **Soft-fail in `release.yml` is a deliberate, time-boxed compromise**, not silent erosion of CI rigor. The condition for re-tightening is explicit (4 clean releases).

### Negative

- **Calendar dependency.** The maintainer must remember off-hours releases. Mitigation: pre-flight script aborts loudly; the README "release procedure" cross-references this ADR.
- **No CI guarantee during business hours.** If a hotfix must ship during peak Claude usage, the maintainer must quit Claude clients first, then release. Acceptable for a single-developer project; would not scale to a team.
- **Soft-failed `integration-gate`** means a real integration regression *could* slip into a release. Mitigation: the integration suite still runs on every PR (where the runner's MCP load is lower because PR runs are often off-hours), and `pnpm test` catches contract regressions independent of OmniFocus. The window where this would bite is narrow.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Maintainer adds a new MCP client class (cron, scheduled remote agent) that runs during off-hours and reintroduces contention | The pre-flight catches it. The new client class triggers an update to this ADR. |
| Pre-flight false positives — the runner's own scripts trigger the threshold | Threshold of 3 osascript processes leaves headroom for one seed-script + two ambient. If false positives persist, raise the threshold or filter by parent PID. |
| Project gains contributors and a single dedicated runner becomes load-bearing | Promote Option C from parking ticket to active work. The hardware-decision filing is the trigger. |
| `release.yml`'s soft-fail is forgotten and never tightened | Track the "4 clean releases" condition in a follow-up issue with an explicit close criterion. |

## References

- [#932](https://github.com/torsday/omnifocus-mcp/issues/932) — the contention incident and three-option analysis that motivated this ADR
- [#933](https://github.com/torsday/omnifocus-mcp/pull/933) — soft-fail `integration-gate` in `release.yml` while this ADR is drafted
- [#914](https://github.com/torsday/omnifocus-mcp/issues/914) — per-test project namespaces (still right; doesn't address contention)
- [#928](https://github.com/torsday/omnifocus-mcp/issues/928) / [#929](https://github.com/torsday/omnifocus-mcp/issues/929) / [#930](https://github.com/torsday/omnifocus-mcp/issues/930) — runner-side state reset (still right; doesn't address contention)
- [#679](https://github.com/torsday/omnifocus-mcp/issues/679) — integration-suite reliability work that justifies keeping integration tests in the release flow
- [ADR-0014](./0014-e2e-harness-strategy.md) — why integration tests run against a live OmniFocus rather than an in-memory adapter
- [ADR-0017](./0017-mutation-testing-release-gate.md) — `release.yml`'s required-check composition, of which integration-gate is a member
- [`docs/runner-setup.md`](../runner-setup.md) — operational doc for the self-hosted runner; this ADR adds a contention section
