# Spike: Bundle-size strategy — code-splitting / tree-shaking vs flat budget bumps

**Date:** 2026-04-28
**Issue:** [#578](https://github.com/torsday/omnifocus-mcp/issues/578)
**Time-boxed:** 1 hour
**Status:** complete

---

## Question

The dist bundle has crossed two budget ceilings in a single ship-loop session
(500 KB → 525 KB → 540 KB) without any structural intervention. Each new tool
adds 3–5 KB of minified code to a single-file bundle that is already mostly
strings. Is there a structural fix — code-splitting, tree-shaking, externalising
heavy strings — that lets the bundle scale linearly without periodic budget
bumps?

---

## Measurement

Built `dist/index.js` at HEAD (post-#573, before #578):

| Metric                              | Bytes     | % of bundle |
| ----------------------------------- | --------- | ----------- |
| **Total bundle**                    | 549,681   | 100.0       |
| String-literal bytes (all literals) | 298,924   | **54.4**    |
| Code (function bodies, runtime)     | ~250,757  | ~45.6       |

Distribution of string literals (2,141 total):

| Bucket                | Count | Notes                                                |
| --------------------- | ----- | ---------------------------------------------------- |
| huge (≥ 2 KB)         | 32    | Inlined JXA / OmniJS scripts and a few descriptions  |
| large (500 B – 2 KB)  | 70    | Tool descriptions, complex schema describes          |
| medium (100 – 500 B)  | 132   | Field describes, error messages                      |
| small (30 – 100 B)    | 391   | Short field describes, identifiers                   |
| tiny (< 30 B)         | 1,516 | Property keys, single-word strings                   |

Largest individual literal: **19,336 bytes** — confirmed to be the inlined
`task_complete.js` JXA script (or comparable). The inlined-scripts directory
on disk totals **532 KB (jxa) + 140 KB (omnijs) = 672 KB** of source `.js`,
which after JSON-string-literal escaping survives the minifier wholesale —
the minifier collapses code, but escaped string content is opaque to it.

Zod schema markers in the bundle: 156 `z.object`, 335 `.describe`, 29
`.enum`, 19 `.refine`. The schema construction at runtime is non-trivial
work both at startup time and in bundle size.

> **Headline.** The bundle is **54% inert text by mass** — descriptions,
> error messages, and JXA/OmniJS scripts. The other 46% is the actual
> server, queues, services, adapters, and validation logic. Adding a new
> tool today adds ~1.5 KB of code and ~3 KB of strings per the
> measurement above.

---

## Why the current approach plateaus

Each new tool adds:

1. ~600 chars of `*_DESCRIPTION` content (with the [NL-quality rubric
   §2](../nl-quality-standards.md#2--worked-examples-in-tool-descriptions)
   pushing toward longer descriptions, including worked `Example:` blocks).
2. 4–8 Zod field `.describe(...)` calls — each carries a runtime string.
3. Often an inlined JXA/OmniJS script of 1–8 KB.

Tree-shaking already runs (`tsup --minify --treeshake`), and there is
little dead code to prune — the runtime imports every tool registration
to wire it into `mcpServer.ts`. The *strings* are the leak, and they
aren't tree-shakeable: every tool registration is reachable from the
single entry point.

---

## Options

### A — Externalise inlined JXA/OmniJS scripts to runtime fs reads

**What.** Reverse [ADR-0005] for distribution: keep `src/scripts/**/*.js`
as first-class editable files in development, but at build time emit them
to `dist/scripts/` and have the runtime read them via `fs.readFileSync` at
first use (cached). Or simpler: ship the package with `dist/scripts/` as
a sibling directory and have `scriptLoader.ts` switch its strategy based
on `import.meta.url` resolution.

**Estimated saving.** The 32 huge string literals (≥ 2 KB) are almost
entirely inlined scripts. Conservative estimate: **150–200 KB removed
from the JS bundle**, deferred to a separate `dist/scripts/` directory
that ships alongside.

**Cost.**
- Adds a runtime fs dependency (already permitted; the server reads the
  user's home directory for attachments).
- Cold-start regression on first script call (~1 ms per file). Negligible
  vs the JXA call cost itself (~200 ms typical).
- Distribution shape changes: published npm package now has a `dist/`
  *directory* of files, not a single `dist/index.js`. Consumers using
  `pnpm dlx` or single-file copy lose one-step deployment.

**Risk.** Medium. Requires updating the publishing pipeline (`files` in
`package.json`), the script loader's resolution logic, and integration
tests that assume the inlined-string contract.

### B — Strip Zod metadata at build time

**What.** Replace each tool's `.describe(...)` with a build-time
indirection that looks up the description from a JSON sidecar at runtime
only when an introspection endpoint asks for it. The MCP SDK reads
descriptions via `inputSchema.shape`'s field metadata; a thin wrapper
around `z.string().describe(...)` could lazy-load the metadata from a
sidecar JSON loaded once at server start.

**Estimated saving.** 335 `.describe()` calls × ~50 chars average = **~17
KB**, plus the per-call construction overhead. Modest.

**Cost.**
- Substantial refactor of every tool input schema.
- Loses the inline readability of describes — the rubric explicitly
  rewards them as documentation.
- Potential SDK incompatibility if the SDK reads describe metadata at
  registration time (untested).

**Risk.** High; not worth pursuing unless other options fall through.

### C — Code-split per tool domain via dynamic import

**What.** Convert `mcpServer.ts`'s flat `register*Tool(...)` calls into
domain-keyed dynamic imports. The SDK supports tool registration at any
point; lazy-load the tool's module on first call.

**Estimated saving.** Effective bundle size at startup drops by 30–40%
(only the registration manifest plus core/observability tools loaded).
On-demand chunks total roughly the same as today.

**Cost.**
- Cold-start regression on first tool call per domain (~10–50 ms for
  the chunk load).
- Distribution complexity — the `dist/` directory becomes a chunk graph,
  same publishing concern as Option A.
- The `omnifocus://capabilities` resource currently introspects all
  registered tools at startup; would need to change to either
  pre-register everything (defeating the point) or report tools by
  manifest rather than runtime registration.

**Risk.** High. The capabilities resource contract is observable and
agents may rely on the full inventory at startup.

### D — Externalise the SDK / Zod via `peerDependencies`

**What.** Move `@modelcontextprotocol/sdk` and `zod` from `dependencies`
to `peerDependencies`. Consumers install them. The bundle stops carrying
their code.

**Estimated saving.** Substantial — Zod alone is roughly 70–90 KB
minified. SDK is another 30 KB.

**Cost.**
- Hard to enforce — most npm consumers don't read peerDeps. A misinstall
  produces obscure runtime failures.
- This is a published binary that runs as a single command (`omnifocus-mcp`
  via the `bin` field). Peers don't apply cleanly to bin-style CLI tools.
- Distribution model is "self-contained CLI"; that's the user contract.

**Risk.** Breaks the published-binary model. Not viable.

### E — Bump the budget on a measured cadence (status quo, formalised)

**What.** Accept that ~3–5 KB per new tool is the structural cost.
Bump the budget by 25 KB every ~10 tools added, tracked in DESIGN §20
with a note in CHANGELOG. No runtime change.

**Cost.** None to the bundle; the budget is just a release gate.

**Risk.** None — the bundle is already shipping fine at 540 KB. The
"problem" is purely tracker hygiene.

---

## Recommendation

**Adopt option A (externalise inlined scripts) as the v1.x intervention.**
File a follow-up issue tracking the 150–200 KB reduction and the
publishing-shape change. This is the only option with a meaningful
saving that doesn't compromise the agent-facing contract or the
self-contained-CLI distribution model.

**Defer options B/C/D indefinitely.** B is high-effort for low return;
C breaks the capabilities-introspection contract; D breaks the published-
binary model.

**For the meantime: option E is fine.** Bump the budget when needed,
in 25 KB steps, with a CHANGELOG note each time. The bundle has plenty
of room to grow before option A becomes mandatory — at the current
~3 KB/tool growth rate, the next ceiling (540 → 565 KB) covers ~8 tool
additions, plenty of runway to ship A as a deliberate piece of work
rather than under pressure.

---

## Concrete next steps

1. **Now (this PR):** ship this spike note. No code changes.
2. **Soon (follow-up issue):** file a `infra: extract dist/scripts/`
   ticket describing option A's implementation and publishing-shape
   change. Tag `needs-design` until the publishing-shape question is
   resolved with an ADR.
3. **As needed:** continue bumping the budget per option E. Each bump
   should reference this spike for context.

---

## Appendix: measurement command

```bash
pnpm build
node -e '
const fs = require("node:fs");
const b = fs.readFileSync("dist/index.js", "utf8");
const all = [...b.matchAll(/(["\x60])(?:\\.|(?!\1).)*\1/g)];
let total = 0;
for (const m of all) total += m[0].length;
console.log("string-literal bytes:", total, "(", (100*total/b.length).toFixed(1), "% of bundle)");
'
```

[ADR-0005]: ../adr/0005-scripts-as-first-class-files.md
