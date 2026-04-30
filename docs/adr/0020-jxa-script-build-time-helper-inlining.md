# ADR-0020: Build-time helper inlining for JXA scripts via `// @inline` directive

**Date:** 2026-04-30
**Status:** Accepted

---

## Context

[ADR-0005](./0005-scripts-as-first-class-files.md) commits us to keeping JXA and OmniJS scripts as first-class editable source files under `src/scripts/`. The build (`tsup` + `scriptInlinerPlugin`) reads each script as raw text and embeds it as a string into the bundled adapter so the server never has to locate script files at runtime.

That mechanism gives us editable sources, but every JXA script is still **structurally standalone**: `osascript -l JavaScript` evaluates each as a top-level program with no module system. Scripts cannot `import` shared code at runtime. The result is systemic copy-paste:

| Helper           | Copies (consumer JXA scripts) | Lines / copy | Drift bugs surfaced |
|------------------|-------------------------------|--------------|--------------------|
| `buildTask`      | 8 (`task_get`, `task_list`, `task_create`, `task_update`, `task_search`, `task_get_many`, `forecast_get`, `perspective_evaluate`) | ~135 | [#673](https://github.com/torsday/omnifocus-mcp/issues/673), [#682](https://github.com/torsday/omnifocus-mcp/issues/682), [#498](https://github.com/torsday/omnifocus-mcp/issues/498) |
| `buildRepetition` | 8 (colocated with `buildTask`) | ~12 | none yet |
| `buildProject`   | 4 (`project_get`, `project_create`, `project_get_many`, `project_list`) | ~120 | not yet — inevitable |
| `buildTag`       | 3 | ~60 | not yet — inevitable |
| `buildFolder`    | 3 | ~50 | not yet — inevitable |

[#673](https://github.com/torsday/omnifocus-mcp/issues/673) was the catalyst: a single OmniFocus 4.x quirk in `containingProject().class()` had to be fixed in ~9 places, and follow-up bugs ([#680](https://github.com/torsday/omnifocus-mcp/issues/680), [#681](https://github.com/torsday/omnifocus-mcp/issues/681), [#682](https://github.com/torsday/omnifocus-mcp/issues/682), [#695](https://github.com/torsday/omnifocus-mcp/issues/695)) traced to incomplete copy-paste of the fix. md5 of the 8 `buildTask` copies confirms real drift today: only 2 of 8 are byte-identical.

Cannot share at runtime. Can share at build time. The bundled adapter is already a build artifact (`dist/`), and `scriptInlinerPlugin` already reshapes script source as it loads. The natural extension is to **expand a directive** during that load step, splicing helper source into the consumer script before it becomes the bundled string.

## Decision

Adopt a `// @inline <relative-path>` directive expanded by `scriptInlinerPlugin` (esbuild + Vite variants) at script-load time.

**Mechanism:**

1. Helper sources live under `src/scripts/jxa/_helpers/` (and `src/scripts/omnijs/_helpers/` symmetrically). They are plain JXA-compatible JavaScript: top-level `function` declarations, no `import`/`export`, no ES-module wrapping. The leading `_` prefix marks them as build-time inputs only — they have no runtime entry point of their own.

2. Consumer scripts declare their dependencies via line comments at the top of the file:

   ```js
   // @inline _helpers/build_task.js
   ```

3. The inliner reads the script, replaces each `// @inline <path>` line with the contents of the referenced file (resolved relative to the consumer script's directory), and returns the expanded source as a default string export. The expansion is the same in the production esbuild path and the vitest Vite path.

4. The directive line itself is replaced by the helper contents — no marker remains in the bundled string. The result is byte-identical to what a hand-pasted helper would produce, which is what `osascript` evaluates.

5. Expansion is single-level, non-recursive in this ADR (a helper file containing `// @inline` lines is a deliberate non-feature for now). Cycles are therefore impossible. If recursion becomes useful later, add it with cycle detection.

**Helper-design rules:**

- Helpers contain only function declarations (`function buildTask(task) { ... }`), not assignments.
- Helpers may declare local utility functions inside themselves but must not collide with any name a consumer script defines at the same scope.
- Helpers parameterize behavior via options arguments rather than splitting into variants. Example: `buildTask(task, { effectiveAvailability: true })` for forecast/search consumers that want `task.effectivelyAvailable()` instead of `task.available()`. This preserves a single canonical helper while supporting per-consumer semantic differences.

**Consumer-design rules:**

- `// @inline` directives are placed at the top of the file, after the docblock, before `function run(argv)`.
- Each directive on its own line. No mid-line directives.
- Order of directives matches the order helpers should appear in the expanded source — the inliner is straightforward textual replacement.

## Alternatives considered

### A. esbuild banner / footer injection

Configure `tsup` to prepend helper sources to every JXA script entry. Rejected: the inliner doesn't go through `tsup` per-script; it intercepts at `onLoad`. Banner injection is also coarse (same banner for every script), and most scripts don't need every helper.

### B. Hand-written preprocessor (sed-like)

A separate `scripts/build-jxa.ts` step that runs before `tsup` and writes expanded scripts to a temp directory `tsup` then reads. Rejected: adds a build step, breaks the existing `import script from "./scripts/jxa/foo.js"` pattern that already produces the bundled string. The inliner already owns this transformation; extending it is a smaller change.

### C. Tagged template literals

Helpers exported as TypeScript template-literal strings, concatenated by consumers via tagged-template syntax. Rejected: would require every consumer script to be authored in TypeScript (or have a `.ts` shim), violating ADR-0005's commitment to JXA scripts being directly `osascript`-runnable for ad-hoc dev work. The `// @inline` directive is invisible to `osascript` as a comment, so consumer scripts remain runnable from the source tree even before the build runs (just without the helper available in the dev path).

### D. Generator script

A code-generator that materializes consumer scripts from templates. Rejected: an extra source-of-truth (templates) plus generated artifacts checked into git or excluded; both are uglier than expanding at the loader boundary.

### E. Continue duplicating, cap drift via tests

Status quo plus a CI check that fails when any pair of `buildTask` copies diverges. Rejected: catches drift after it lands, doesn't reduce surface area, doesn't help maintenance, and is the exact pattern that produced the [#673](https://github.com/torsday/omnifocus-mcp/issues/673) class of bugs.

## Consequences

### Benefits

- **One canonical source per helper.** Every fix lands in one place. Drift bugs of [#673](https://github.com/torsday/omnifocus-mcp/issues/673)'s class become structurally impossible.
- **Smaller working surface.** Net diff after migrating all five JXA helpers is ≈ −1800 lines.
- **Better test surface.** The sandbox harness ([commit `72d659d`](https://github.com/torsday/omnifocus-mcp/commit/72d659d)) can target the helper directly rather than re-testing each consumer's copy. Tracked under [#679](https://github.com/torsday/omnifocus-mcp/issues/679).
- **No runtime cost.** The expansion happens at build / test-load time. The string `osascript` evaluates is identical to a hand-pasted equivalent.
- **Dev-path preserved.** A consumer script with unexpanded `// @inline` directives is still valid JavaScript (the directives are comments). It won't produce the right output if `osascript`'d directly without the helper in scope, but `osascript`-ing a single bundle script in production is not the dev path — the dev path is the unit / sandbox tests, which expand via the Vite plugin.

### Costs

- Reading a consumer script source no longer shows the full code that runs. The reader has to follow `// @inline` directives to the helper file. Mitigated by short, descriptive helper paths and a one-line comment at the top of each consumer.
- The `_helpers/` directory matches `SCRIPTS_RE` and is therefore picked up by the loader as a default-string-export module too. Harmless because nothing imports them by path — but documented as a convention so it isn't tripped over.
- Behavior changes during reconciliation must be enumerated and reviewed. The first migration ([#686](https://github.com/torsday/omnifocus-mcp/issues/686)) merges 8 `buildTask` copies into one canonical version, with the `effectiveAvailability` flag preserving the only intentional semantic split.

### Risks

- **Reconciliation correctness.** Merging N drifted copies into one canonical version is the same operation that creates drift in the first place — done wrong, it bakes a regression into every consumer at once. Mitigation: a per-field rationale in the merge PR, the integration suite as the safety net, and the [#682](https://github.com/torsday/omnifocus-mcp/issues/682) / [#673](https://github.com/torsday/omnifocus-mcp/issues/673) / [#498](https://github.com/torsday/omnifocus-mcp/issues/498) inline comments preserved verbatim.
- **Inliner divergence between esbuild and Vite paths.** The same `expandInlineDirectives` helper is called from both plugins. A unit test asserts equivalence on a fixture so it can't drift silently.

## References

- [ADR-0005: Scripts as first-class files](./0005-scripts-as-first-class-files.md)
- [Issue #686 — refactor(jxa): DRY JXA scripts via build-time helper inlining](https://github.com/torsday/omnifocus-mcp/issues/686)
- [Issue #673 — buildTask drift catalyst](https://github.com/torsday/omnifocus-mcp/issues/673)
- [Issue #679 — testing-coverage gap (consumes the DRY'd shapes)](https://github.com/torsday/omnifocus-mcp/issues/679)
