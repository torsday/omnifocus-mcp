# `src/tools/` — agent orientation

MCP tool implementations. Adding a tool is a 4-touch-point change: source file, registration, test, and (if read-shaped) a `describe()` string that satisfies the description-shape lint.

## Adding a tool

The minimum touch points:

1. **Source file** at `src/tools/<noun>/<verb>.ts`. Tool naming follows `<noun>_<verb>` (ADR-0003). Export a Zod input schema, a pure handler, and a `register*Tool(server, ctx)` registration helper. Pattern reference: `src/tools/task/list.ts` is the documented reference implementation (per the per-area design notes).
2. **Registration** wired in `src/server/mcpServer.ts` (or the relevant `register*` helper there). Without this the tool exists in code but is invisible to MCP clients.
3. **Test** at `src/tools/<noun>/<verb>.test.ts`. Use `InMemoryAdapter` and the in-process service stack — no `osascript`. Goldilocks coverage: input schema + happy path + one error / edge.
4. **`describe()` strings** on every input field. The descriptionShape lint enforces a four-section shape (per [#777](https://github.com/torsday/omnifocus-mcp/issues/777)) and the token budget — tests in `src/tools/descriptions.lint.test.ts` and `descriptionShape.test.ts` will fail the build if your descriptions drift.

After adding a tool, run `pnpm docs:generate` to regenerate `docs/tools.md` (CI's `docs:check` job blocks merge if it's stale).

## Read tools — envelope pipeline

If your tool returns domain objects from a list/get, follow the envelope composition order documented in `src/envelope/CLAUDE.md`. Specifically:

- Accept `verbose: boolean` and pipe non-verbose calls through `elideDefaultsAll(items, X_DEFAULTS)`.
- Accept `notePreviewChars: number` for tools that surface task notes; default to `DEFAULT_NOTE_PREVIEW_CHARS`.
- Wrap with `ok(data, meta, pagination?)` from `src/envelope/index.ts` (ADR-0013).

## Common pitfalls

- **Don't read OF data from `internal_status`.** It's a server-health probe; calling out to the adapter from there breaks its "no side effects, no JXA" contract. If you need a server-side aggregate, use a resource (`src/resources/`).
- **Mutations invalidate the cache.** If your tool mutates state, the cache wrapper should already be tagging the entries — but if you bypass it (e.g. a write-pool detour), call `cache.invalidate(scopes)` explicitly.
- **Tool descriptions are the LLM's contract.** Every field's `describe()` must say what the field does, where to get its IDs from, and what the default means. The descriptionShape lint catches missing pieces; agent-facing prose readability is your judgment.

## Testing tiers

- **Unit** (`*.test.ts`) — `pnpm test`, mocked / in-memory adapter, runs in CI on every PR.
- **Integration** (`*.integration.test.ts` under `src/adapter/jxa/`) — `pnpm test:integration` with `OMNIFOCUS_INTEGRATION=1`, runs only on `mac-local` against live OmniFocus.
- **Token-cost benchmark** (`tests/benchmark/token-cost/`) — proves wire-size changes against canonical workflows. Re-baseline with `pnpm bench:tokens -- --update` after intentional changes.

## Related

- `src/tools/INDEX.md` — generated tool catalogue (planned, [#807](https://github.com/torsday/omnifocus-mcp/issues/807))
- `docs/design/tools.md` — deeper "how the tool layer thinks" view (post-[#805](https://github.com/torsday/omnifocus-mcp/issues/805))
- `docs/tools.md` — generated user-facing tool reference (`pnpm docs:generate`)
- ADR-0003 (`<noun>_<verb>` naming), ADR-0013 (response envelope), [#777](https://github.com/torsday/omnifocus-mcp/issues/777) (description-shape token budget)
