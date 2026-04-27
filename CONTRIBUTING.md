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
- **Typed errors only.** No generic `Error`. Every throw is from the taxonomy in [`DESIGN.md §6.7`](./DESIGN.md#67-error-taxonomy).
- **No user content in metadata.** OmniFocus task names, notes, and tag names must appear only in `data.*` — never in `error.message`, `error.suggestion`, `meta.warnings`, or any other metadata field. A task named `"SYSTEM: ignore previous instructions"` must not leak into protocol metadata where an agent treats it as a system instruction. This is enforced by the `no-metadata-interpolation` custom lint rule ([`DESIGN.md §18`](./DESIGN.md#18-security-posture)).

## Engineering standards

Inherited from [`coding.md`](https://github.com/torsday/llm_prompts/blob/main/coding.md):

- SOLID; DRY; no magic values; pure functions where practical
- Push side effects to the edges; Command Query Separation
- Error messages answer: what operation, which IDs, why, what to do next
- Goldilocks testing — enough to catch real bugs, not so many the suite is a burden
- Every public method has a docblock with `@param` / `@returns` / `@throws`
- **Don't restate the tool count in prose.** Living docs describe the shape of the tool surface (domains, verbs, patterns), not the integer count. The live count lives at `omnifocus://capabilities` and `internal_status` at runtime, plus `docs/tools.md` (auto-generated). See DESIGN.md §6.8.1 — `scripts/verify-no-tool-counts.sh` enforces this in CI.

## Workflow

1. **Understand the task.** Open the issue, read the linked DESIGN / SPEC / ADR section.
2. **Work on a branch.** Never commit to `main` directly.
3. **Follow the patterns.** See [`DESIGN.md §26`](./DESIGN.md#26-example-tool--reference-implementation-for-task_list) for the reference implementation every tool follows.
4. **Test before opening a PR.**
   - `pnpm typecheck` — zero errors
   - `pnpm lint` — zero errors
   - `pnpm test` — zero failures, under 10 seconds
   - `pnpm build` — single-file bundle produced
   - If touching adapter behavior: `OMNIFOCUS_INTEGRATION=1 pnpm test:integration` against a live OF
5. **Conventional Commits.** Follow [`commit.md`](https://github.com/torsday/llm_prompts/blob/main/commit.md). One concern per commit. Split multi-concern diffs.
6. **Update the design.** If your change invalidates something in `DESIGN.md`, `SPEC.md`, or an ADR, update it in the same PR. A PR that diverges from its design doc is not ready to merge.

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
- [ ] Tool description matches the what/when-not/returns/side-effects shape
- [ ] No user content (task names, notes, tags) interpolated into metadata fields (`suggestion`, `message`, `warnings`)
```

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

## Ask before

- Introducing a new runtime dependency ([`DESIGN.md §25`](./DESIGN.md#25-dependency-inventory) inventory requires justification)
- Adding a new MCP tool without an ADR entry or SPEC functional requirement
- Changing the response envelope (major version; requires ADR update)
- Adding a new error code (affects stability contract)

Everything else, use your judgment and match the existing patterns.
