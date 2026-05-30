# ADR-0024: Non-cursor reads report a dropped-id list when the maxOutputBytes cap truncates

**Date:** 2026-05-30
**Status:** Accepted

---

## Context

The `maxOutputBytes` response cap ([#776](https://github.com/torsday/omnifocus-mcp/issues/776), the final stage of the envelope pipeline `project → elide → truncate → cap`) lets a caller pre-commit to an upper bound on the serialized size of a read's result array. The server returns as many whole items as fit, signals truncation via `meta.truncatedAtCap` / `meta.bytesReturned` / `meta.itemsReturned` and a `WARN_RESULT_TRUNCATED` warning, and the caller resumes from where the page was cut.

For **cursor-paginated** reads (`task_list`, `search_query`, `project_list` — [#1059](https://github.com/torsday/omnifocus-mcp/issues/1059)) "resume where it was cut" is a continuation **cursor** re-anchored at the last kept item (`applyByteCap` + each service's `cursorFor`).

But several heavy reads have **no cursor**:

- **Bulk-by-id** — `task_get_many`, `project_get_many`, `tag_get_many`. The caller already supplies the exact id set (schema-bounded to ≤100); there is no filter/sort to anchor a cursor against.
- (Future, [#1060](https://github.com/torsday/omnifocus-mcp/issues/1060)) other bounded reads such as `tag_list`.

A cursor is meaningless for these: there's no ordered query to resume. Yet the cap still needs a *continuation contract* — the caller must learn which items it didn't receive so it can get them. Minting a synthetic offset cursor for an id-keyed batch would be a fiction (the "query" is the id array itself) and would couple these tools to the cursor codec for no benefit.

## Decision

Add a sibling helper `applyByteCapById` (alongside `applyByteCap`) that shares the identical byte-accounting (`countKeptPrefix`) but, instead of a cursor, returns **`droppedIds`** — the ids of the trailing items removed to satisfy the cap, in input order.

Non-cursor reads, when capped, return:

- `meta.truncatedAtCap: true`, `meta.bytesReturned`, `meta.itemsReturned` — identical to the cursor case.
- A `WARN_RESULT_TRUNCATED` warning whose `details` carry **`droppedIds: string[]`** (in addition to `bytesReturned` / `itemsReturned`), with the suggestion to re-request those ids in a smaller batch or with a higher cap.
- **No pagination block** (these tools never had one).

The `WARN_RESULT_TRUNCATED` code is reused (additive `details.droppedIds`), keeping the warning taxonomy stable per ADR-0011. Sibling per-id maps on a response (e.g. `task_get_many`'s `waitingOn` / `decisions`, keyed by task id) are filtered to the kept ids so they never reference a dropped item.

Invariants carried over from #776: an unset cap is a no-op; the caller's value is clamped to the server hard ceiling; at least one item is always returned (a single oversized item is emitted whole, with the rest reported as `droppedIds`).

## Consequences

- **Uniform truncation signal across all heavy reads.** Cursor and non-cursor reads share `meta.truncatedAtCap` + byte/item counts and the same warning code; only the continuation token differs (cursor vs. `droppedIds`). Agents branch on which field is present.
- **`missing` vs. `droppedIds` are distinct on bulk reads.** `WARN_IDS_NOT_FOUND.details.missing` = ids that don't exist; `WARN_RESULT_TRUNCATED.details.droppedIds` = ids that exist but were trimmed by the cap. Both can appear on one response; an agent re-requests `droppedIds` but not `missing`.
- **No new cursor surface.** Bulk tools stay decoupled from the cursor codec.

### Alternatives considered

- **Synthetic offset cursor for bulk reads** — rejected: the "query" is the caller's id array, so an offset cursor would just re-encode "the ids after index N," which the caller already has. `droppedIds` says it directly.
- **A new `WARN_RESULT_TRUNCATED_BY_ID` code** — rejected: same semantic event (hit the size ceiling); additive `details.droppedIds` keeps the taxonomy smaller and the agent's switch simpler.
- **Silently drop the tail with only a count** — rejected: the agent couldn't tell *which* items it lost, defeating a deterministic re-request.

## References

- [#776](https://github.com/torsday/omnifocus-mcp/issues/776) — `maxOutputBytes` cap mechanism (cursor model)
- [#1059](https://github.com/torsday/omnifocus-mcp/issues/1059) — cap on cursor-paginated reads
- [#1060](https://github.com/torsday/omnifocus-mcp/issues/1060) — this work (non-cursor reads)
- ADR-0013 (response envelope), ADR-0011 (additive warning evolution)
- `src/envelope/cap.ts` — `applyByteCap` / `applyByteCapById`
