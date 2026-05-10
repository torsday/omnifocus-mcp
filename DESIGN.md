# Design: omnifocus-mcp

**Status:** v1.0 — implemented and shipped 2026-04-25
**Date:** 2026-04-19 (initial); shipped 2026-04-25
**Evaluates:** `SPEC.md`

A design document in the `systems_design.md` tradition: surfaces options, names tradeoffs, commits a recommendation, and flags what's being cut. Load-bearing decisions are recorded as ADRs under `docs/adr/`.

This file is now a thin index. The actual design content lives under [`docs/design/`](./docs/design/) — split per [#805](https://github.com/torsday/omnifocus-mcp/issues/805) so each area is a focused, navigable file.

## Reading order

- **First time here:** read [`decisions.md`](./docs/design/decisions.md) (problem framing + options) then [`architecture.md`](./docs/design/architecture.md). That's enough to understand the shape.
- **Implementing:** [`envelope.md`](./docs/design/envelope.md), [`ids-and-dates.md`](./docs/design/ids-and-dates.md), [`example-tool.md`](./docs/design/example-tool.md) — these define the patterns every tool follows.
- **Operating:** [`concurrency-and-lifecycle.md`](./docs/design/concurrency-and-lifecycle.md), [`security.md`](./docs/design/security.md), [`testing-and-ci.md`](./docs/design/testing-and-ci.md), [`observability.md`](./docs/design/observability.md), [`configuration.md`](./docs/design/configuration.md).
- **Understanding a decision:** section → linked ADR under `docs/adr/`.

## Files

| File | One-line summary |
|------|------------------|
| [`docs/design/decisions.md`](./docs/design/decisions.md) | Problem framing, options for runtime/transport/tool surface/escape hatch, R/S/M evaluation, what's being cut |
| [`docs/design/architecture.md`](./docs/design/architecture.md) | Layering, directory layout, adapter interface, script discipline, caching, concurrency, error taxonomy, tool description standard, observability, circuit breaker, loop detection |
| [`docs/design/envelope.md`](./docs/design/envelope.md) | Tool response envelope — success and error shapes, mutation contract |
| [`docs/design/ids-and-dates.md`](./docs/design/ids-and-dates.md) | ID branding strategy and ISO-8601-with-offset date contract (incl. floating time zones) |
| [`docs/design/pagination.md`](./docs/design/pagination.md) | Cursor-based pagination, guardrails, sort order |
| [`docs/design/concurrency-and-lifecycle.md`](./docs/design/concurrency-and-lifecycle.md) | Read pool, write queue, backpressure, thundering herd; startup/shutdown sequence |
| [`docs/design/security.md`](./docs/design/security.md) | Threat model, control matrix, non-goals |
| [`docs/design/testing-and-ci.md`](./docs/design/testing-and-ci.md) | Five-tier test strategy, coverage policy, mutation testing, CI pipeline, required status checks |
| [`docs/design/observability.md`](./docs/design/observability.md) | Log format, event taxonomy, `internal_status` snapshot, correlation |
| [`docs/design/configuration.md`](./docs/design/configuration.md) | Environment-variable surface |
| [`docs/design/distribution-and-versioning.md`](./docs/design/distribution-and-versioning.md) | npm package, install patterns, semver contract, dependency inventory |
| [`docs/design/example-tool.md`](./docs/design/example-tool.md) | Reference implementation for `task_list` — pattern every tool follows |
| [`docs/design/i18n.md`](./docs/design/i18n.md) | UTF-8, locale, English-only error messages |
| [`docs/design/resources.md`](./docs/design/resources.md) | MCP resources, prompts, project templates, fenced note metadata, decision journal |

## Migration map (old `DESIGN.md §N` → new file)

| Old | New |
|-----|-----|
| §1 Problem framing | [`decisions.md`](./docs/design/decisions.md) |
| §2 Language + runtime | [`decisions.md`](./docs/design/decisions.md) |
| §3 OF transport | [`decisions.md`](./docs/design/decisions.md) |
| §4 Tool surface | [`decisions.md`](./docs/design/decisions.md) |
| §5 Raw script tools | [`decisions.md`](./docs/design/decisions.md) |
| §6 Architecture (incl. §6.7 errors, §6.8 description standard) | [`architecture.md`](./docs/design/architecture.md) |
| §7 R/S/M evaluation | [`decisions.md`](./docs/design/decisions.md) |
| §8 What's being cut | [`decisions.md`](./docs/design/decisions.md) |
| §9 Build sequence | retained in git history; superseded by GitHub Issues + milestones |
| §10 Evaluation checklist | retained in git history; covered by [`decisions.md`](./docs/design/decisions.md) R/S/M section |
| §11 Cross-references | replaced by this index + ADR `docs/adr/` |
| §12 Tool response envelope | [`envelope.md`](./docs/design/envelope.md) |
| §13 ID strategy | [`ids-and-dates.md`](./docs/design/ids-and-dates.md) |
| §14 Date & time handling | [`ids-and-dates.md`](./docs/design/ids-and-dates.md) |
| §15 Pagination | [`pagination.md`](./docs/design/pagination.md) |
| §16 Concurrency & backpressure | [`concurrency-and-lifecycle.md`](./docs/design/concurrency-and-lifecycle.md) |
| §17 Lifecycle | [`concurrency-and-lifecycle.md`](./docs/design/concurrency-and-lifecycle.md) |
| §18 Security posture | [`security.md`](./docs/design/security.md) |
| §19 Testing strategy | [`testing-and-ci.md`](./docs/design/testing-and-ci.md) |
| §20 CI/CD | [`testing-and-ci.md`](./docs/design/testing-and-ci.md) |
| §21 Observability | [`observability.md`](./docs/design/observability.md) |
| §22 Configuration | [`configuration.md`](./docs/design/configuration.md) |
| §23 Distribution & install | [`distribution-and-versioning.md`](./docs/design/distribution-and-versioning.md) |
| §24 Versioning & stability | [`distribution-and-versioning.md`](./docs/design/distribution-and-versioning.md) |
| §25 Dependency inventory | [`distribution-and-versioning.md`](./docs/design/distribution-and-versioning.md) |
| §26 Example tool (`task_list`) | [`example-tool.md`](./docs/design/example-tool.md) |
| §27 Internationalization & encoding | [`i18n.md`](./docs/design/i18n.md) |
| §28 MCP resources | [`resources.md`](./docs/design/resources.md) |
| §29 MCP prompts | [`resources.md`](./docs/design/resources.md) |
| §30 Project templates | [`resources.md`](./docs/design/resources.md) |
| §31 Synthetic data on tasks/projects | [`resources.md`](./docs/design/resources.md) |
