# Idempotency contract

omnifocus-mcp's mutation tools support an optional `idempotency_key` argument so callers can retry safely across network blips, MCP-transport drops, and agent-loop replays without producing duplicate writes. Two callers passing the same key within the TTL window get the same envelope; the second is marked `meta.idempotentReplay = true` so the agent can distinguish "I did this" from "the server did this earlier."

The store ([`src/server/idempotencyStore.ts`](../src/server/idempotencyStore.ts)) is module-scoped: a single in-memory LRU+TTL keyed by the caller-supplied `idempotency_key`. Tools that opt in wrap their handler body with `withIdempotencyKey(store, input.idempotency_key, fn)`. Tools that don't omit the schema field; the wrapper is a no-op when the key is `undefined`.

This document is the source of truth for which mutation tools accept the key today, which don't, and the contract for adding it to a new tool. Audit produced by [#836](https://github.com/torsday/omnifocus-mcp/issues/836).

## Coverage matrix

Every MCP mutation tool is in exactly one row. `✓` = the tool accepts `idempotency_key` in its input schema AND wires it through `withIdempotencyKey`. `—` = the tool does not accept the key today.

### Task mutations

| Tool | `idempotency_key` | Notes |
|---|---|---|
| `task_create` | ✓ | |
| `task_update` | ✓ | |
| `task_delete` | ✓ | |
| `task_complete` | — | |
| `task_uncomplete` | — | |
| `task_drop` | — | |
| `task_undrop` | — | |
| `task_move` | — | |
| `task_reorder` | — | |
| `task_duplicate` | — | |
| `task_defer_smart` | ✓ | |
| `task_convert_to_project` | — | |
| `task_reclassify` | — | |
| `task_extract_from_image` | — | Multimodal input — content-hash idempotency is a separate question (image bytes vary by encoding). |
| `task_extract_from_note` | — | |
| `task_parse_transport_text` | — | Read-shaped (parses to a draft) — arguably doesn't need idempotency. |

### Task batch mutations

| Tool | `idempotency_key` | Notes |
|---|---|---|
| `task_batch_create` | — | Batches need idempotency more than single calls — retrying a half-applied batch without a key duplicates the applied subset. |
| `task_batch_update` | ✓ | (Schema accepts the key; replay returns the cached envelope.) |
| `task_batch_delete` | — | |
| `task_batch_complete` | — | |
| `task_batch_uncomplete` | — | |
| `task_batch_drop` | — | |
| `task_batch_undrop` | — | |
| `task_batch_move` | — | |
| `task_batch_assign` | — | |
| `task_batch_defer_smart` | ✓ | |

### Project mutations

| Tool | `idempotency_key` | Notes |
|---|---|---|
| `project_create` | ✓ | |
| `project_update` | ✓ | |
| `project_delete` | ✓ | |
| `project_complete` | — | |
| `project_drop` | — | |
| `project_move` | — | |
| `project_batch_complete` | — | |
| `project_batch_drop` | — | |
| `project_mark_reviewed` | — | |
| `project_template_save` | — | |
| `project_template_delete` | — | |
| `project_template_instantiate` | — | |

### Tag / folder / note / decision / review

| Tool | `idempotency_key` | Notes |
|---|---|---|
| `tag_create` | — | |
| `tag_update` | — | |
| `tag_delete` | — | |
| `tag_move` | — | |
| `tag_set_status` | — | |
| `tag_set_location` | — | |
| `tag_set_allows_next_action` | — | |
| `folder_create` | — | |
| `folder_update` | — | |
| `folder_delete` | — | |
| `folder_move` | — | |
| `note_set` | — | Whole-note overwrite — replay-safe by shape but a key would still help in chained-write workflows. |
| `note_set_html` | — | |
| `note_append` | ✓ | `append` is not naturally idempotent — replays without a key duplicate the appended text. Key support is load-bearing (#981). |
| `decision_record` | ✓ | Append-shaped audit trail — replays without a key duplicate journal entries. Key support added in #981. |
| `decision_clear` | — | |
| `review_mark_reviewed` | — | |

### Attachment / webhook / app / database / plugin

| Tool | `idempotency_key` | Notes |
|---|---|---|
| `attachment_add` | — | Per #836's notes: auto-generated attachment IDs make this genuinely hard to idempotency-key without content hashing. Treat as never-retryable. |
| `attachment_remove` | — | |
| `webhook_register` | — | |
| `webhook_delete` | — | |
| `webhook_test` | — | |
| `app_launch` | — | Idempotent by shape — already returns `{launched, alreadyRunning}`; a key would be redundant. |
| `app_window_new` | — | |
| `app_window_new_tab` | — | |
| `window_set_focus` | — | |
| `window_set_perspective` | — | |
| `database_undo` | — | Stateful — undoing twice undoes two things. Key support is meaningful here. |
| `database_redo` | — | Same. |
| `plugin_invoke` | — | Plugin author's contract. |
| `forecast_set_tag` | — | |
| `task_set_alarms` / `task_clear_alarms` | — | |
| `task_set_repetition` / `task_clear_repetition` | — | |
| `task_set_waiting_on` / `task_clear_waiting_on` | — | |
| `perspective_create` / `perspective_update` / `perspective_delete` | — | |
| `import_opml` / `import_taskpaper` | — | Large imports — partial-apply on a retry without key would be especially painful. |
| `sync_trigger` | — | Already idempotent by shape (no-ops if a sync is in flight). |

## Retry interaction (REL-1 / [#816](https://github.com/torsday/omnifocus-mcp/issues/816))

The retry-once policy added in [#816](https://github.com/torsday/omnifocus-mcp/issues/816) restricts retries to **read-only JXA scripts** — `READ_ONLY_JXA_SCRIPTS` in [`src/adapter/jxa/scriptRunner.ts`](../src/adapter/jxa/scriptRunner.ts). Writes never retry.

Acceptance criterion 4 from [#836](https://github.com/torsday/omnifocus-mcp/issues/836) — **retry-allowed ⊆ idempotency-supported** — is therefore trivially satisfied today: the retry-allowed set is exactly the empty set of mutation tools. No write call can be retried by the adapter without explicit caller opt-in (an idempotency key), and the retry-once path doesn't reach mutation scripts at all.

If the retry policy is ever broadened to include any subset of mutation scripts, that change must come with a corresponding gate: every newly-retryable mutation script must have been promoted to ✓ in the matrix above first. The transport circuit ([#835](https://github.com/torsday/omnifocus-mcp/issues/835)) is the architectural counterpart — it short-circuits sustained failures so the agent-level retry-with-key flow stays sane.

## Adding idempotency to a new mutation tool

The wiring is mechanical. Reference: [`src/tools/task/update.ts`](../src/tools/task/update.ts).

1. Add `idempotency_key: z.string().min(1).max(128).optional()` to the input schema with a `describe()` string.
2. Inject the `IdempotencyStore` via the tool's context — `idempotencyStore: IdempotencyStore` alongside `adapter`, `makeMeta`, etc.
3. Wrap the handler body in `withIdempotencyKey(ctx.idempotencyStore, input.idempotency_key, async () => { /* existing body */ })`. The wrapper threads `meta.idempotentReplay` automatically.
4. Add a test asserting same-key-replay returns the cached envelope and `meta.idempotentReplay === true`.
5. Add a row in the matrix above (this file).

## Follow-up work

This audit deliberately scopes to the inventory + contract; per-tool key adoption and a cross-cutting integration replay test are out of scope. Tracking:

- Adding `idempotency_key` to the high-value tools currently at `—` (task batch mutations and project status changes — `note_append` and `decision_record` shipped in #981) → individual issues per tool family, filed by the audit follow-up.
- An integration test that exercises replay across the wire (same key, same input → same envelope with `idempotentReplay: true`; same key, different input → ValidationError or fresh execution depending on policy) → filed as a separate issue.

## References

- [`src/server/idempotencyStore.ts`](../src/server/idempotencyStore.ts) — implementation
- [#234](https://github.com/torsday/omnifocus-mcp/issues/234) — store rollout
- [#138](https://github.com/torsday/omnifocus-mcp/issues/138) — per-tool adoption tracker
- [#816](https://github.com/torsday/omnifocus-mcp/issues/816) — retry-once policy (read-only-only)
- [#835](https://github.com/torsday/omnifocus-mcp/issues/835) — transport circuit breaker
- ADR-0008 (response envelope) — see [`docs/adr/`](./adr/) — defines where `meta.idempotentReplay` lives in the envelope
