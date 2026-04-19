# ADR-0005: JXA and OmniJS scripts as first-class source files

**Date:** 2026-04-19
**Status:** Accepted

---

## Context

Every tool in this MCP executes a JXA or OmniJS script against OmniFocus. We expect ~65 scripts at steady state. There are two ways to manage these scripts in the codebase:

1. **Inline template literals** in the service/adapter code: `` const script = `...` ``
2. **Separate `.js` files** loaded at build or runtime

The choice affects readability, testability, linting, and the blast radius of a change.

## Decision

Scripts live as **separate `.js` files under `src/scripts/{jxa,omnijs}/`**. Each script:

- Is a `.js` file (not `.ts`) — the runtime is `osascript`/OmniJS, which accepts plain JS
- Is typed via JSDoc with `@typedef` imports from a shared `types.d.ts`
- Reads its parameters from a single JSON argument: `process.argv[1]` (JXA) or `argument` (OmniJS)
- Returns a single JSON string as its final expression
- Is loaded at build time by `tsup` via a `raw`-style plugin that inlines file contents as strings

## Options Considered

| Option | Pros | Cons |
| ------ | ---- | ---- |
| Inline template literals | One less build step; script + handler in one file | Scripts can't be linted; escaping headaches with `${}` and backticks; diffing large scripts inside TS strings is painful; no syntax highlighting |
| **Separate `.js` files, build-time inlined** | Scripts are first-class: linted, formatted, syntax-highlighted, diffable; JSDoc gives us types; handlers stay small | Extra build-step complexity; each new tool adds one file |
| Scripts as runtime-loaded files from `dist/` | Simplest build | Fragile distribution — the `.js` files must be shipped alongside the bundle; `npx` users get a harder install |
| Scripts as WASM / compiled assets | Future-proof | Massive overkill; no compiler targets JXA/OmniJS |

## Consequences

**Positive**

- A script is a file you can open, run locally, test in Script Editor, and paste into OmniFocus plugin prototyping
- Lint rules apply: unused variables, dead code, mistakes in control flow
- Type hints via JSDoc give us editor support without forcing TypeScript onto `osascript`
- Build produces a single distributable — scripts are inlined, no separate files to ship
- Scripts are individually testable: a script runner in tests invokes a script with a given input and asserts the parsed JSON output (integration tests only)

**Negative**

- Every tool adds one file to `src/scripts/`
- Build pipeline is slightly more complex (needs the inlining step)
- A mismatch between a script's expected JSON shape and the adapter's call site is a runtime error, not a compile error — mitigated by JSDoc types and by integration tests that exercise each script

**Risks**

- **Inlining bugs** in the build step — mitigated by a "smoke test" at CI that boots the bundled server and verifies a trivial script runs
- **Drift** between a script and its adapter method — mitigated by adapter methods living alongside their scripts (same directory) and by integration tests exercising the pair

## References

- `DESIGN.md` §6.4 — script asset discipline
- `tsup` documentation — loader plugin mechanism
