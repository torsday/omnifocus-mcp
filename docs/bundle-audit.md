# Bundle size & dead-code audit (#827)

Resumes the tree-shaking / dead-code audit started in #578 (closed without
follow-up). Baseline captured 2026-05-28.

## Bundle baseline

| Artifact        | Size       | Notes                                  |
| --------------- | ---------- | -------------------------------------- |
| `dist/index.js` | **874 KB** | single ESM bundle, `tsup` (esbuild)    |

The server ships as one tree-shaken ESM file targeting Node 24. esbuild already
performs dead-code elimination at bundle time, so **unused source exports do not
contribute to bundle size** — they're shaken out. The bundle-growth pressure
called out in #786 (`tools/list` grows ~1.6 KiB per shipped feature) is driven
by *shipped, registered* tools, not by dead exports. Reducing it means shipping
fewer/smaller tool schemas, not deleting unused code; that's tracked separately
under the token-efficiency epic (#770), not here.

**Conclusion:** bundle size is justified for the current feature set; no ≥10%
win is available from dead-code removal (esbuild already elides it). The value of
this audit is **source maintainability** + **ongoing counter-pressure**, below.

## Dead-code counter-pressure: knip

The #578 follow-up gap was "no active counter-pressure" against dead code. This
adds [`knip`](https://knip.dev) as a dev dependency with a `knip.json` config and
a `pnpm knip` script. Run it to inventory unused files, exports, types, and
dependencies. Config notes:

- Entries: `src/index.ts` (the server) + `src/**/*.test.ts` (so exports used only
  by tests are not falsely flagged).
- `ignoreExportsUsedInFile: true` — an export used only within its own module
  (e.g. a `*Options` interface consumed by its class constructor) is a style
  choice, not dead code, so it isn't reported.
- Intentionally-retained-but-currently-unused exports are tagged `@public` in
  their JSDoc (see below) so knip treats them as part of the public surface.

## Removed (accidental dead code)

- **Unused dependency:** `zod-to-json-schema` (the MCP SDK does its own schema
  conversion; our direct dep was unreferenced).
- **Unused barrel files:** `src/concurrency/index.ts`, `src/lifecycle/index.ts`,
  `src/observability/index.ts`, `src/tools/observability/index.ts` (re-export
  barrels with zero importers).
- **Unused exports:** `isoWeekStartIso`, `TASK_NAME_CANDIDATE_MAX_CHARS`
  (duplicate of `NAME_MAX_CHARS`), `DEFAULT_DB_PATH`, `summaryNoteSetById`,
  `summaryNoteAppendById`, `_defaultCache` (test seam never used),
  `IdKind`, `ActionKey`, `DescribeResult`, `ChangedObjects`.

## Retained intentionally (`@public`)

Not dead — kept as forward-looking / documented public surface, tagged `@public`
so knip doesn't flag them:

- Canonical domain validators `attachmentSchema`, `FolderSchema`, `TagSchema`,
  `PerspectiveSchema`, `PerspectiveDetailSchema` — match
  `docs/domain-reference.md`; retained for adapter/CRUD use (folder CRUD is #54).
- `StrayStdout` error class — documented taxonomy member `OF_STRAY_STDOUT`
  (`docs/errors.md`); part of the public error surface even if not yet thrown.
