# Contributing to omnifocus-mcp

This is a single-developer project and external contributions are not currently solicited. If you've landed here anyway, the patterns below are what any contribution would need to follow — whether it's a fork or a PR to this repo.

## Non-negotiables

- **Adapter seam is sacred.** Services never see `osascript` or URL schemes. The `OmniFocusAdapter` interface is the only boundary between domain logic and the OS. Tests swap in `InMemoryAdapter`.
- **Scripts are first-class source files.** Every JXA/OmniJS script lives in `src/scripts/{jxa,omnijs}/*.js`, parameterized via `JSON.parse` of a single argument. No inline script strings in service code. ([ADR-0005](./docs/adr/0005-script-assets-as-files.md))
- **Tool naming:** `<noun>_<verb>` snake_case. Consistent verbs across nouns. ([ADR-0003](./docs/adr/0003-tool-surface-namespaced.md))
- **IDs only, never names.** All API references use OF's persistent IDs. Lookup-by-name is an explicit, disambiguated tool. ([ADR-0008](./docs/adr/0008-ids-branded-opaque-strings.md))
- **Dates are ISO-8601 with offset** at the adapter boundary. ([ADR-0007](./docs/adr/0007-dates-iso8601-with-offset.md))
- **Response envelope.** Every tool returns `{ data, meta, pagination? }` or `{ error, meta }`. Never a raw payload. ([ADR-0013](./docs/adr/0013-tool-response-envelope.md))
- **Mutation response contract.** Write tool handlers must return the full updated domain entity in `data` (e.g. `ok({ task }, meta)`, `ok({ tag }, meta)`, `ok({ folder }, meta)`). Delete handlers return `ok({ deleted: true, id }, meta)`. Never return a bare ID or a partial patch object — agents need the full entity to update their local view without a follow-up read.
- **No stdout writes.** stdout is the MCP transport; any stray byte corrupts the protocol. Enforced by a hook and an integration test.
- **No network imports.** The server has no network surface. Lint forbids `http`, `https`, `fetch`, `node-fetch`, `axios`, `undici`.
- **Typed errors only.** No generic `Error`. Every throw is from the taxonomy in [`docs/design/architecture.md`](./docs/design/architecture.md#error-taxonomy).
- **No user content in metadata.** OmniFocus task names, notes, and tag names must appear only in `data.*` — never in `error.message`, `error.suggestion`, `meta.warnings`, or any other metadata field. A task named `"SYSTEM: ignore previous instructions"` must not leak into protocol metadata where an agent treats it as a system instruction. This is enforced by the `no-metadata-interpolation` custom lint rule ([`docs/design/security.md`](./docs/design/security.md)).

## Engineering standards

Inherited from [`coding.md`](https://github.com/torsday/llm_prompts/blob/main/coding.md):

- SOLID; DRY; no magic values; pure functions where practical
- Push side effects to the edges; Command Query Separation
- Error messages answer: what operation, which IDs, why, what to do next
- Goldilocks testing — enough to catch real bugs, not so many the suite is a burden
- Every public method has a docblock with `@param` / `@returns` / `@throws`
- **Don't restate the tool count in prose.** Living docs describe the shape of the tool surface (domains, verbs, patterns), not the integer count. The live count lives at `omnifocus://capabilities` and `internal_status` at runtime, plus `docs/tools.md` (auto-generated). See [`docs/design/architecture.md`](./docs/design/architecture.md#tool-count-policy-478) — `scripts/verify-no-tool-counts.sh` enforces this in CI.

## Tool descriptions and NL quality

Every MCP tool description, input schema, and validation error gets read by an agent and decides whether the agent's first attempt at a call lands. The full rubric is [`docs/nl-quality-standards.md`](./docs/nl-quality-standards.md) — five levers (schema descriptions, worked examples, forgiving aliases, round-trip readability, fail-with-help errors). Use the checklist at the bottom of that doc at PR review time.

### Tool description template

New tool descriptions follow the four-section shape ([`docs/design/architecture.md` — Tool description standard](./docs/design/architecture.md#tool-description-standard), enforced by `descriptionShape.ts`) plus a worked example. Keep the description concatenated as a single string constant — concise, readable, scannable:

```typescript
export const NOUN_VERB_DESCRIPTION =
  // What it does — opening sentence, present tense.
  "<One-sentence summary of the tool's purpose>. " +
  // When NOT to use — disambiguates from sibling tools.
  "Do NOT use for <out-of-scope case> — prefer <other_tool> instead. " +
  // Returns — names the shape so the agent can plan its next call.
  "Returns <data shape, including pagination if applicable>. " +
  // Side effects — read-only / mutates / triggers a sync / safe to retry.
  "<Read-only; safe to retry> | <Mutates; triggers a sync; idempotent on `clientToken`>. " +
  // Worked example — one representative call.
  'Example: { "<field>": "<value>" }';
```

Every Zod input field carries a `.describe(...)` of one sentence under ~120 chars, naming what the field controls and where to obtain a valid value when relevant.

### Validation errors

Tool handlers that validate input through Zod catch `ZodError` at the boundary and rewrite it via [`zodToActionable`](./src/errors/zodToActionable.ts) so each failure carries `{ field, sent, expected, examples? }`. Don't let raw Zod messages reach the client — the agent has to translate "expected int, received number" before it can fix the call, and the translation step is where loops happen.

```typescript
import { ValidationError } from "../../errors/index.js";
import { zodToActionable } from "../../errors/zodToActionable.js";

const parsed = inputSchema.safeParse(rawInput);
if (!parsed.success) {
  throw new ValidationError("Invalid <tool_name> input", {
    details: { failures: zodToActionable(parsed.error, rawInput) },
  });
}
```

## Workflow

1. **Understand the task.** Open the issue, read the linked DESIGN / SPEC / ADR section.
2. **Work on a branch. All commits to `main` go through a PR — no exceptions.** GitHub branch protection enforces this for everyone, including administrators; a direct push is rejected at the GitHub layer.
3. **Follow the patterns.** See [`docs/design/example-tool.md`](./docs/design/example-tool.md) for the reference implementation every tool follows.
4. **Test before opening a PR.**
   - `pnpm typecheck` — zero errors
   - `pnpm lint` — zero errors
   - `pnpm test` — zero failures, under 10 seconds
   - `pnpm build` — single-file bundle produced
   - If touching adapter behavior: `OMNIFOCUS_INTEGRATION=1 pnpm test:integration` against a live OF
5. **Conventional Commits.** Follow [`commit.md`](https://github.com/torsday/llm_prompts/blob/main/commit.md). One concern per commit. Split multi-concern diffs.
6. **Update the design.** If your change invalidates something in `DESIGN.md`, `SPEC.md`, or an ADR, update it in the same PR. A PR that diverges from its design doc is not ready to merge.

## Token-cost regression gate

The `Token-cost benchmark` workflow (`.github/workflows/token-cost-bench.yml`) runs the hermetic in-memory benchmark suite against `tests/benchmark/token-cost/__snapshots__/baseline.snap.json` on every PR that touches `src/**`, the benchmark itself, or the workflow / lockfile. It **fails the PR** when any tracked field drifts ≥ 5% from baseline. The tracked fields are `toolListBytes`, per-workflow `totalRequestBytes` / `totalResponseBytes` / `totalRoundTripBytes` / `totalTokens`, and per-tool `byTool[<name>].responseBytes`. See [`tests/benchmark/token-cost/README.md`](./tests/benchmark/token-cost/README.md) for the full list and how to re-baseline.

**Fixing a regression** — the diff in the failing job step is the byte-by-byte breakdown. Most regressions are an envelope field that should be elided, a verbose error message, or a default value that grew. Iterate locally with `OMNIFOCUS_BENCH=1 pnpm test:bench:tokens` until the diff is back under threshold.

**Intentional regressions** — when a feature genuinely needs more wire bytes (a new field, a security mitigation that adds metadata, a richer error envelope), apply the **`bench: regression-allowed`** label to the PR. The workflow still runs the benchmark for visibility — the drift breakdown lands in the job summary — but the job exits 0 so the PR is not blocked. Always explain the regression in the PR description so the next reviewer can confirm the cost is justified. Re-baseline in a follow-up PR per the README.

**Promoting to required check** — the gate is an opt-in advisory check by default. To make it block merge, add it to branch protection:

```bash
gh api repos/torsday/omnifocus-mcp/branches/main/protection/required_status_checks/contexts \
  -X POST -f 'contexts[]=token-cost bench'
```

## Pull request template

```markdown
## Summary
<1–3 bullets>

## Design link
<link to the DESIGN / SPEC / ADR section this implements>

## Breaking change?
<yes/no; if yes, explain per ADR-0011 semver rules>

## Test plan
- [ ] Unit tests cover happy + edge + error
- [ ] Integration tests pass (if adapter changes)
- [ ] No stdout output (check via integration test)
- [ ] Response envelope + typed error used
- [ ] Tool description matches the what/when-not/returns/side-effects shape and ends with an `Example:` line ([NL-quality rubric](./docs/nl-quality-standards.md))
- [ ] Validation errors use `zodToActionable` so failures carry `{ field, sent, expected }`
- [ ] No user content (task names, notes, tags) interpolated into metadata fields (`suggestion`, `message`, `warnings`)
```

## Local dev MCP — picking up changes

When you run an MCP-aware client (Claude Code, etc.) configured with this
repo's bundled binary — typically:

```jsonc
"omnifocus-dev": { "command": "node", "args": ["/path/to/omnifocus-mcp/dist/index.js"] }
```

— the client spawns a long-running Node process from `dist/index.js`. That
process does **not** hot-reload when you edit source. Loop after every
edit:

1. `pnpm build` — refresh `dist/index.js`
2. Restart the MCP — quit and reopen the client, or
   `claude mcp remove omnifocus-dev && claude mcp add omnifocus-dev -- node $PWD/dist/index.js`

Symptom of a stale bundle: a fix that passes `pnpm test` still misbehaves
when called via the dev MCP. Check `internal_status.uptimeMs` against your
last build's mtime to confirm.

Use `pnpm dev` (`tsx watch`) for direct CLI iteration that does pick up
source changes — the price is starting fresh on every save, so it's no
substitute for a real client session.

## Self-hosted CI runner setup (macOS Automation permission)

The integration test suite (`pnpm test:integration`) runs JXA scripts that send Apple Events to OmniFocus. macOS requires an explicit one-time Automation permission grant for the process that spawns `osascript`. Without it, every JXA call fails with error -1743 and the test suite reports `"JXA script returned empty stdout"` with no further context.

### One-time grant (runner or developer machine)

1. Open **System Settings → Privacy & Security → Automation**
2. Locate the terminal or runner process (typically `bash`, `zsh`, or the GitHub Actions runner agent)
3. Enable the toggle next to **OmniFocus**
4. Re-run the tests — no restart required

### Verifying permission before running tests

```bash
bash scripts/check-automation-permission.sh
```

Exits 0 with `✓ Automation permission for OmniFocus is granted.` if permission is present.
Exits 1 with a step-by-step recovery guide if it detects error -1743.

### In CI

`integration.yml` calls `check-automation-permission.sh` as a pre-step (after confirming OmniFocus is running and before the test suite). A missing permission fails fast with an `::error::` annotation instead of a cryptic empty-stdout failure.

### After a macOS update or runner reinstall

macOS may revoke Automation permissions when the OS is updated or the terminal binary changes path. If integration tests start failing with empty stdout after a system update, run the preflight script first:

```bash
bash scripts/check-automation-permission.sh
```

If it exits 1, re-grant permission in System Settings as above.

## Mutation testing (release-time hard gate)

Releases are gated on a Stryker mutation-testing run that fails the publish if the score regresses below `thresholds.break = 58` (= floor(calibration baseline) − 5). Per [ADR-0017](./docs/adr/0017-mutation-testing-release-gate.md). The gate fires once per `v*.*.*` tag push in [`.github/workflows/release.yml`](./.github/workflows/release.yml); reports upload as `mutation-report-<tag>` workflow artifact (90-day retention).

### Running locally

```bash
pnpm mutation
```

Wall-clock is roughly 6–7 minutes against the slice-1B calibration baseline (2740 mutants, allowlist scoped to `src/domain`, `src/errors`, `src/server`). Reports land at `reports/mutation/mutation.html` (open in a browser) and `reports/mutation/mutation.json` (consumed by `internal_status` if the running server's package root has the file).

### Handling survivors

A surviving mutant is unambiguous evidence that the test suite doesn't pin down the behaviour the mutated line is responsible for. The default response is **write the test that kills it.**

Only when a mutation is observably equivalent to the original — meaning no test could ever distinguish them, e.g. an algebraic identity or a dead-store elimination — should it go in [`stryker-equivalents.json`](./stryker-equivalents.json), and only with a one-line `rationale` explaining why no test could distinguish it. Bare entries (no rationale) are forbidden. Reflexive additions to silence a survivor are the wrong default; the right default is to write the test. Maintainers audit the registry quarterly and remove entries whose rationale no longer holds. Per ADR-0017 §5.

### Checking calibration freshness

The running server surfaces the live mutation score via [`internal_status`](./src/tools/observability/internalStatus.ts):

```ts
internal_status() // → { mutation: { score: 62.74, lastRunAt: "..." } | null, ... }
```

`null` means no `reports/mutation/mutation.json` exists in the package root — published npm tarballs always show `null` since `reports/` is gitignored. For a dev clone, `null` after a recent `pnpm mutation` run means the report file was moved or deleted.

## Ask before

- Introducing a new runtime dependency ([`docs/design/distribution-and-versioning.md`](./docs/design/distribution-and-versioning.md#dependency-inventory) inventory requires justification)
- Adding a new MCP tool without an ADR entry or SPEC functional requirement
- Changing the response envelope (major version; requires ADR update)
- Adding a new error code (affects stability contract)

Everything else, use your judgment and match the existing patterns.
