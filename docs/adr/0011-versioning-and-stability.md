# ADR-0011: Versioning and stability contract

**Date:** 2026-04-19
**Status:** Accepted

---

## Context

This MCP server is a public API to LLM agents. Agent operators (humans) will pin to specific versions; agents themselves learn tool names and schemas from `tools/list` at runtime. Breakage comes in two flavors:

1. **Silent** — same tool name, same input schema, but different return shape or behavior. Worst kind; agents succeed incorrectly.
2. **Loud** — tool renamed or removed, required field added. Agent errors clearly; user sees the failure.

We need a clear definition of what counts as a breaking change so upgrades are predictable, and a deprecation cycle so we can evolve the surface without leaving users stranded.

## Decision

**Semver 2.0** with an explicit contract definition.

### Public contract (breaking changes bump major)

- **Tool names** — rename = major
- **Required input fields** — adding a required field = major; renaming = major
- **Input field types** — narrowing an accepted type = major
- **Response envelope shape** (`data`, `meta`, `pagination`, `error`) — changing field names, types, or removing fields = major
- **Error `code` identifiers** — renaming or removing = major
- **Resource URIs** (`omnifocus://inbox`, `omnifocus://project/{id}`) — rename = major
- **CLI invocation surface** (`omnifocus-mcp [args]`) — removing args = major

### Additive changes (minor)

- New tool
- New optional input field
- New output field (append-only to `data`)
- New error code
- New resource URI
- New `meta` field

### Non-contract (not versioned)

- Log event names and their extra fields
- Internal script contents
- Bundle size, startup time, cache hit rate
- Adapter interface signatures (internal)

### Deprecation cycle

- Deprecated tool/field/code: marked with `[DEPRECATED]` in description; logs a `warn` once per session when invoked
- Minimum one minor version between deprecation and removal
- CHANGELOG.md calls out each deprecation under `## Deprecated` and each removal under `## Breaking`

## Options Considered

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **Semver with explicit contract definition** | Industry standard; clear rules; deprecation path | Occasional majors feel heavy for small renames; pressure to batch breaking changes |
| CalVer (calendar versioning) | Predictable cadence | Doesn't signal compatibility; agents can't distinguish safe-to-upgrade from risky |
| "Always backward compatible" (never major) | Marketing-friendly | Accumulates cruft; real breaks happen anyway and are disguised as "migrations" |
| No versioning (single rolling release) | Simplest to publish | Users have no way to pin; any regression breaks every install simultaneously |

## Consequences

**Positive**

- Users can pin (`"@torsday/omnifocus-mcp": "^1.2"`) with confidence
- Agent prompt-caches that include tool descriptions are stable across patches
- Deprecation cycle surfaces pending breakage in warnings, before it bites

**Negative**

- Discipline required on every change to assess breaking/additive/non-contract
- Major bumps feel expensive; may discourage useful renames
- Deprecation cycle adds a minor-version round trip for any rename

**Risks**

- **Agents reading `tools/list` at runtime** don't honor version pinning — if the server is upgraded and a tool's semantics drift, the agent sees new behavior. Mitigated by the deprecation cycle and by tests that snapshot tool descriptions.
- **Silent behavior changes** (same schema, different behavior) slip through semver — mitigated by integration tests that assert observable behavior per tool.
- **Dependency updates** that change tool descriptions or response shapes (e.g. MCP SDK) — we treat downstream SDK changes as breaking if they alter the wire contract. Pinned versions in lockfile.

## References

- `DESIGN.md` §12 — response envelope; §24 — versioning & stability
- Semver 2.0 spec — semver.org
- `~/src/github.com/torsday/llm_prompts/release_notes.md` — CHANGELOG conventions
