# Contributing to omnifocus-mcp

This is a single-developer project and external contributions are not currently solicited. If you've landed here anyway, the patterns below are what any contribution would need to follow — whether it's a fork or a PR to this repo.

## Non-negotiables

- **Adapter seam is sacred.** Services never see `osascript` or URL schemes. The `OmniFocusAdapter` interface is the only boundary between domain logic and the OS. Tests swap in `InMemoryAdapter`.
- **Scripts are first-class source files.** Every JXA/OmniJS script lives in `src/scripts/{jxa,omnijs}/*.js`, parameterized via `JSON.parse` of a single argument. No inline script strings in service code. ([ADR-0005](./docs/adr/0005-script-assets-as-files.md))
- **Tool naming:** `<noun>_<verb>` snake_case. Consistent verbs across nouns. ([ADR-0003](./docs/adr/0003-tool-surface-namespaced.md))
- **IDs only, never names.** All API references use OF's persistent IDs. Lookup-by-name is an explicit, disambiguated tool. ([ADR-0008](./docs/adr/0008-ids-branded-opaque-strings.md))
- **Dates are ISO-8601 with offset** at the adapter boundary. ([ADR-0007](./docs/adr/0007-dates-iso8601-with-offset.md))
- **Response envelope.** Every tool returns `{ data, meta, pagination? }` or `{ error, meta }`. Never a raw payload. ([ADR-0013](./docs/adr/0013-tool-response-envelope.md))
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

## Ask before

- Introducing a new runtime dependency ([`DESIGN.md §25`](./DESIGN.md#25-dependency-inventory) inventory requires justification)
- Adding a new MCP tool without an ADR entry or SPEC functional requirement
- Changing the response envelope (major version; requires ADR update)
- Adding a new error code (affects stability contract)

Everything else, use your judgment and match the existing patterns.
