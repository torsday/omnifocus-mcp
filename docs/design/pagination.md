<!-- Originally DESIGN.md §15 (split per #805) -->

# Pagination

List-shaped reads support cursor-based pagination with a **safe default cap**. Clients can override `limit` up to a hard ceiling or follow `cursor` for additional pages.

## Shape

Input (optional):

```typescript
{
  limit?: number;       // 1..1000; default: 200
  cursor?: string;      // opaque; from previous response
}
```

Output pagination block (present on every list tool response):

```typescript
{
  cursor: string | null;   // null means "no more results"
  hasMore: boolean;
  total?: number;          // omitted when computing it would double the cost
}
```

## Guardrails on unbounded queries

A `task_list` with no filter and no limit could return 50k rows on a large database, blowing the p95 SLO and the MCP response size. Two guardrails:

1. **Default limit of 200.** Clients who explicitly want more pass `limit`; unbounded queries must chase the cursor.
2. **Zod refinement on list schemas:** at least one of `{ limit, cursor, projectId, tagIds, available, completed, dueBefore, dueAfter, deferredBefore, parentId }` must be provided. Absent any of these, we reject with `ValidationError { code: "OF_VALIDATION", suggestion: "Provide a filter or a limit" }`. Prevents accidental full-table scans.

## Cursor construction

- Opaque to clients; base64url-encoded internally
- Encodes `{ lastCreatedAt, lastId, filterHash }`
- **Sort order is `(createdAt ASC, id ASC)`** — `createdAt` primary, `id` as deterministic tiebreak. OF's persistent IDs are short alphanumerics and not monotonic; sorting by ID alone would be non-deterministic across runs
- Invalidated on `filterHash` mismatch (returns `ValidationError`); the client must start a fresh query if filters change

## Why cursor, not offset

Offset pagination double-reads and has consistency issues under mutation. Cursors are stable and let JXA evaluate `created > lastCreatedAt OR (created == lastCreatedAt AND id > lastId)` cheaply inside the script.
