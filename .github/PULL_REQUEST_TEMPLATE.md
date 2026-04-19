<!-- Delete sections that don't apply. Keep it short. -->

## Summary

<1–3 bullets on what this PR does and why>

## Design link

<Issue number + link to the DESIGN.md / SPEC.md / ADR section this implements>

Closes #N

## Breaking change?

- [ ] No
- [ ] Yes — semver major per [ADR-0011](../docs/adr/0011-versioning-and-stability.md). See `CHANGELOG.md` under `## Breaking`.

## Test plan

- [ ] Unit tests cover happy + edge + error
- [ ] Integration tests pass against live OF (if adapter changes)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` are green
- [ ] No stdout output during server run (stdout is MCP transport)
- [ ] Response envelope + typed error used; no `Error` thrown generically
- [ ] Tool description matches the what / when-not / returns / side-effects shape

## Conventions checklist

- [ ] Follows project conventions in `CLAUDE.md`
- [ ] Follows engineering standards in `~/src/github.com/torsday/llm_prompts/coding.md`
- [ ] Conventional Commits (`feat:`, `fix:`, `docs:`, etc.)
- [ ] Any new dependency justified in the PR description
- [ ] Docs updated if public surface changed
