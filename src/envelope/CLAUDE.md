# `src/envelope/` — agent orientation

Tool-response envelope contracts. The success-path of every read tool flows through here; the order in which envelope helpers compose changes the payload semantics, so start with the composition rule.

## Composition order

`project → elide → truncate → cap`. Each step assumes the previous has already run; reordering changes wire shape:

1. **Project** (planned, [#773](https://github.com/torsday/omnifocus-mcp/issues/773)) — keep only the fields the caller asked for via `fields[]`. Done first because the next steps shouldn't waste work on fields about to be dropped.
2. **Elide** (`elideDefaults.ts` + `defaultsRegistry.ts`) — drop fields equal to their documented default per `docs/token-cost.md`. Tools accept `verbose: true` to bypass.
3. **Truncate** (`src/tools/task/notePreview.ts`, [#775](https://github.com/torsday/omnifocus-mcp/issues/775)) — replace long `note` with `notePreview` + `noteTruncated` + `noteLength`. `notePreviewChars: -1` opts out.
4. **Cap** (`cap.ts`, [#776](https://github.com/torsday/omnifocus-mcp/issues/776)) — `applyByteCap` enforces an optional `maxOutputBytes` wire-byte ceiling, trimming whole items and re-anchoring the continuation cursor at the last kept one. Last so it sees the post-elide post-truncate size. Wired into `task_list` as the reference; remaining heavy-read tools tracked as a follow-up. Each tool supplies a `cursorFor` callback that resumes at the first dropped item (see `taskService.cursorForListItem`).

If you add a new transformation, decide which step in the pipeline it belongs to before writing it. Two transformations in the same step should commute; if they don't, they're separate steps.

## Defaults registry

`defaultsRegistry.ts` lists the per-domain default values (`TASK_DEFAULTS`, `PROJECT_DEFAULTS`, `TAG_DEFAULTS`, `FOLDER_DEFAULTS`). Adding a field to a domain interface means deciding whether it has a default; if yes, register it here in the same PR. Forgetting leaves the field always-present on the wire and silently bloats responses.

The convention: an *absent* field on the wire means the default applies; a field present with `null` is "explicitly cleared." For most response fields these are semantically identical and we elide both. `projectId` on tasks is an intentional exception — null vs missing carries inbox-vs-unknown semantics. Document any new exception in the registry's docblock.

## Per-tool contract

Every read tool that uses these helpers must:

- Accept a `verbose: boolean` input flag (default false → elide; true → full shape).
- Document the elision in its `describe()` string ("…fields equal to their documented default are omitted…").
- Apply elision *after* any tool-specific shaping (e.g. `applyNotePreview` runs before elision in `task_list.handler`).

## Other helpers in this module

- `index.ts` — the `ok()`, `err()`, `clarificationNeeded()` envelope builders + `Warning` / `WarningCode` taxonomy. Per ADR-0013, tools build envelopes through these helpers; the lint at `src/tools/descriptionShape.test.ts` and CI's `lint-custom` enforce the shape.
- `Warning` codes are stable contract — additive only per ADR-0011. Adding a new code is a minor-version change; removing one is breaking.

## Testing

- Unit tests live alongside (`elideDefaults.test.ts`, `index.test.ts`).
- Integration coverage of the full pipeline lives in tool-level tests (e.g. `src/tools/task/list.test.ts` covers verbose / non-verbose / default-elided / non-default-preserved).
- Benchmark coverage ([#771](https://github.com/torsday/omnifocus-mcp/issues/771)): `pnpm test:bench:tokens` measures bytes through canonical workflows. After any envelope change, regenerate the baseline (`pnpm bench:tokens -- --update`) and commit the diff with the PR.

## Related

- `docs/design/envelope.md` — the deeper "how the system thinks" view (post-[#805](https://github.com/torsday/omnifocus-mcp/issues/805))
- `docs/token-cost.md` — defaults registry user-facing reference
- ADR-0013 (response envelope), ADR-0011 (versioning + breaking changes), ADR-0022 (`content[].text` → placeholder in v2)
