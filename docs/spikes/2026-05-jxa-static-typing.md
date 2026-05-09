# JXA static-typing spike — survey of approaches to catch OF version drift at PR time

**Date:** 2026-05-09
**Issue:** [#826 — spike(jxa): evaluate options for static type and contract checking of jxa scripts](https://github.com/torsday/omnifocus-mcp/issues/826)
**Decision:** ✅ **Adopt a phased approach — Phase 1: ship a `.sdef` → `.d.ts` generator + opt-in `// @ts-check`; Phase 2: extend `src/linting/customRules.ts` with rules encoding the documented OF 4.x runtime quirks. Defer a runtime probe (Phase 3) until coverage of the existing integration suite proves insufficient.**

---

## Why the spike exists

Nine issues in the recurring "silent OF API drift" cluster — `#275`, `#319`, `#331`, `#498`, `#515`, `#673`, `#674`, `#682`, `#687` — share a structural cause: the JXA scripts under [`src/scripts/jxa/`](../../src/scripts/jxa) call OmniFocus APIs that compile cleanly under `osascript` and run cleanly under one OF version, then start throwing or returning wrong-shaped values under a later one. The bug surfaces in production runs against real databases, not in CI.

The hypothesis: a static checker that knows the OF API surface — derived from a source the OF team controls — could catch a meaningful fraction of these at PR time, before they reach a release tag.

This spike tests the hypothesis end-to-end with a working prototype against the live OF 4.x scripting dictionary.

---

## What was measured

The prototype lives at [`scripts/spikes/jxa-static-typing-spike.ts`](../../scripts/spikes/jxa-static-typing-spike.ts). It:

1. Parses [`/Applications/OmniFocus.app/Contents/Resources/OmniFocus.sdef`](https://omni-automation.com/omnifocus/dictionary.html) (the AppleScript scripting dictionary, 118 KB XML).
2. Emits a `.d.ts` for three representative entity classes: `Folder`, `Tag`, `Task`.
3. Cross-references the documented OF 4.x quirks (from [`src/scripts/jxa/CLAUDE.md`](../../src/scripts/jxa/CLAUDE.md)) against the parsed types — would static-type checking catch each?

### Surface area in the .sdef

| Metric | Count |
|---|---|
| Total classes (`<class>`) | 47 |
| Class extensions | 3 |
| Properties (`<property>`) | 256 |
| Elements / collections (`<element>`) | 54 |
| Properties on Folder / Tag / Task | 9 / 11 / 39 |

### Generator output (excerpt)

```ts
/** OmniFocus 'folder' (sdef code: FCAr) */
export interface Folder {
  id(): string;
  name(): string;
  note(): string;
  hidden(): boolean;
  effectivelyHidden(): boolean;
  creationDate(): Date;
  modificationDate(): Date;
  container(): any;
  containingDocument(): any;
  // child collections: sections, folders, projects, flattenedProjects, flattenedFolders
}
```

Note the absence of `parent` from every entity class — that absence is the spike's load-bearing finding.

### End-to-end TypeScript check

A test file (`/tmp/spike-tsc-test.ts`) imports the generated types and calls the three known-bad APIs:

```ts
const _bad1 = folder.parent();         // OF 4.8.8 throws "Can't convert types" (#515)
const _bad2 = tag.parent();            // OF 4.x throws "Can't convert types"
const _bad3 = tag.containingTag();     // OF 4.x throws
```

`tsc --noEmit --strict` raises:

```
spike-tsc-test.ts(14,22): error TS2339: Property 'parent' does not exist on type 'Folder'.
spike-tsc-test.ts(15,19): error TS2339: Property 'parent' does not exist on type 'Tag'.
spike-tsc-test.ts(16,19): error TS2339: Property 'containingTag' does not exist on type 'Tag'.
```

Static-type detection of #515 — the canonical regression from the cluster — works.

---

## Quirk-by-quirk coverage

| # | Quirk (from CLAUDE.md / referenced issue) | Caught by static types? | Why |
|---|---|:-:|---|
| 1 | `tag.parent()` throws — use `tag.container()` | ✅ | Property absent from Tag in .sdef |
| 2 | `folder.parent()` throws — use `folder.container()` (#515) | ✅ | Property absent from Folder in .sdef |
| 3 | `tag.containingTag()` throws | ✅ | Property absent from Tag in .sdef |
| 4 | `containingProject().class()` throws on real Project specifiers (#673) | ❌ | `class()` exists at type level; throws are runtime-only |
| 5 | `creationDate()` may throw "Can't get object" even when truthy (#498) | ❌ | Property is in .sdef; runtime-only quirk |
| 6 | `flattenedTasks.byId(badId)` returns a `-1728` stub specifier, not `null` (#674) | ❌ | Return type is `Task`; the stub-vs-real distinction is runtime |
| 7 | Naive `defaultDocument.flattenedTasks()` blows the 30s scriptRunner timeout | ❌ | Types model API shape, not cost |

**Coverage: 3 of 7 documented quirks (43%) caught at PR time by static types alone.**

The 3 caught are the highest-impact class — the `parent`-call cluster. They produce an opaque "Can't convert types" stderr that surfaces only on the real database, and they have shipped undetected before (`#515` for three release tags). The 4 remaining are runtime-only and need a different strategy.

---

## Survey of the four approaches

| Approach | Maintenance cost | False-positive rate | OF version coupling | Catches |
|---|---|---|---|---|
| **(A) Hand-written JSDoc + `// @ts-check`** | High — author every property by hand across 66 scripts | Low if accurate | Tight; manual update each OF version | Same as B but more work |
| **(B) Generator: `.sdef` → `.d.ts`** | Low — regenerate after OF version bump; one tool | Low — derived from the OF team's own dictionary | Auto-tracks .sdef; pin a snapshot in repo | Calls to non-existent properties (3/7 quirks above), typos |
| **(C) Custom AST / regex checker** (extends [`src/linting/customRules.ts`](../../src/linting/customRules.ts)) | Low per rule (each known-bad pattern = one regex) | Tunable | Loose — rules are project-specific guard rails | Runtime-only patterns once articulated as text patterns (4/7 quirks above) |
| **(D) Lightweight runtime probe** (gated by `OMNIFOCUS_INTEGRATION=1`) | Moderate — probe needs maintenance with API surface | Very low — runtime is ground truth | Loose — probe runs against installed OF; behavior shifts surface as test failures | Emergent OF version drift on whatever surface the probe exercises |

**(A) is strictly dominated by (B)** — same coverage with manual maintenance. Reject.

**(B) and (C) are complementary**, not competing: B catches "property doesn't exist" at type-check time; C catches "property exists but is known to behave badly" at lint time.

**(D) is partially redundant with the existing `*.integration.test.ts` suite gated by `OMNIFOCUS_INTEGRATION` and the `mac-local` runner.** The integration suite already exercises real OF behavior end-to-end. A dedicated probe would be more *targeted* (faster, focused on quirky APIs) but the existing suite already serves the same fail-fast role.

---

## Decision

### Phase 1 (next 1–2 ship cycles): build the `.sdef` → `.d.ts` generator

- Promote the spike's generator from `scripts/spikes/jxa-static-typing-spike.ts` into a real `scripts/generate-jxa-types.ts`.
- Output: `src/scripts/jxa/_types/omnifocus.d.ts` — emit the full class graph (47 classes), not just the 3 representatives.
- Resolve entity-reference types (today returned as `any`) into proper interface references.
- Add `// @ts-check` and `/// <reference path="_types/omnifocus.d.ts" />` to one read script as a beachhead.
- Wire `tsc --noEmit --allowJs` over `src/scripts/jxa/**/*.js` into CI as a non-blocking warning at first; promote to required after a clean week.
- Pin the .sdef snapshot in-repo so CI doesn't depend on a particular OS install. Refresh the snapshot when bumping the supported OF version (manual `pnpm sync:sdef`).

**Why first:** highest leverage, lowest ongoing cost, and addresses the worst-impact quirks (the parent-call cluster). Generator effort is ~1 day; rollout to remaining 65 scripts is mechanical.

### Phase 2 (after Phase 1 lands): encode runtime quirks as custom-lint rules

Extend [`src/linting/customRules.ts`](../../src/linting/customRules.ts) with patterns for the 4 runtime-only quirks the type system can't see. Each rule is one regex plus an `IN_SCRIPTS_RE` guard, modeled on the existing `no-empty-catch-in-scripts` rule:

- `containing-project-class-must-be-try-guarded` (#673)
- `flattened-tasks-byid-must-route-through-lookup-or-throw` (#674)
- `defer-date-getter-must-be-try-guarded` (covers the #498 family)
- `flattened-tasks-without-narrow-source` (perf — flag uses where a `tagId` / `projectId` arg is in scope)

Each is ~10–20 lines of regex + a unit test. Today's existing rules cover similar territory (`no-empty-catch-in-scripts`, `no-generic-error`) and ship without false-positive complaints; the same shape extends cleanly.

**Why after Phase 1:** Phase 1 catches the headline quirks first. Phase 2 fills the runtime-only gaps once the static-typing infrastructure is in place — partly because some Phase-2 rules will become unnecessary once the call sites are themselves typed.

### Phase 3 (deferred): runtime probe

Defer until evidence emerges that the integration suite is missing a class of regression that a focused probe would catch faster. The existing integration suite already runs the full JXA surface; a dedicated probe is a future optimization, not a current need.

---

## Trade-offs accepted

- **The .sdef can drift from runtime behavior.** OF can ship a version where a property is in the dictionary but throws at runtime (the `creationDate()` family). Phase 1 alone won't catch this; Phase 2's custom rules + the existing integration suite handle it.
- **The .sdef snapshot has to be updated manually on OF version bumps.** This is a one-time cost per OF release. Compared to chasing post-release regression reports, it's net negative work.
- **`// @ts-check` on JXA `.js` files requires care.** The scripts are not modules; ambient declarations are the right shape, but the build inliner (ADR-0020) must continue to ship the runtime as plain JS. Phase 1 keeps types as a static-check-only artifact.
- **Phase 1 won't catch the #498 / #673 / #674 cluster.** Those need Phase 2. The phased plan accepts this — solving 43% of the cluster in Phase 1 is significant on its own.

---

## Follow-ups

- File a Phase-1 implementation issue (`feat(scripts): generate src/scripts/jxa/_types/omnifocus.d.ts from OmniFocus.sdef`).
- File a Phase-2 implementation issue (`infra(lint): encode OF 4.x runtime quirks as customRules entries`).
- Phase 3 stays unfiled — re-evaluate after a quarter of Phase 1 + 2 in production.

---

## References

- [`src/scripts/jxa/CLAUDE.md`](../../src/scripts/jxa/CLAUDE.md) — the documented quirk list this spike measures against
- [`src/linting/customRules.ts`](../../src/linting/customRules.ts) — the existing custom-lint surface Phase 2 extends
- [`src/adapter/jxa/sandbox/`](../../src/adapter/jxa/sandbox/) — the runtime test harness (precedent for Phase 3 if needed)
- [`docs/spikes/2026-04-jxa-spike.md`](2026-04-jxa-spike.md) — the original JXA round-trip viability spike
- [ADR-0005 — script assets as files](../adr/0005-script-assets-as-files.md)
- [ADR-0020 — JXA script build-time helper inlining](../adr/0020-jxa-script-build-time-helper-inlining.md)
- [Apple's Scripting Definition Format reference](https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/reference/ASLR_terminology.html)
