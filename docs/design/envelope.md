<!-- Originally DESIGN.md §12 (split per #805) -->

# Tool response envelope

Every tool returns a JSON object with a uniform shape. This is the stability contract (per ADR-0011); fields can be added, never removed or renamed without a major version.

> NL-excellence extensions to this envelope (additive in v1.x): a third `clarification` response kind, an optional `hints[]` array on `ok`, and a `meta.humanReadableSummary` field on writes. See [ADR-0015](../adr/0015-nl-excellence-response-envelope.md).

## Success envelope

```typescript
interface ToolSuccess<T> {
  data: T;                      // tool-specific payload (typed per tool)
  meta: {
    correlationId: string;      // ULID, echoed to logs
    durationMs: number;
    cacheHit: boolean;
    transport: "jxa" | "omnijs" | "cache" | "memory";
    ofVersion: string;          // e.g. "4.5.2"
    syncPending?: boolean;      // true on mutations if unsent changes exist; agent uses to decide when to call sync_trigger
    warnings?: string[];        // non-fatal issues surfaced to the agent
  };
  pagination?: {                // present on list-shaped tools only
    cursor: string | null;      // opaque; pass to next call or null at end
    hasMore: boolean;
    total?: number;             // only when cheap to compute
  };
}
```

## Error envelope

```typescript
interface ToolError {
  error: {
    code: string;               // e.g. "OF_NOT_RUNNING"
    message: string;            // human readable, English, no internals
    suggestion?: string;        // what the agent should do next
    details?: Record<string, unknown>; // per-error-code structured payload
  };
  meta: {
    correlationId: string;
    durationMs: number;
    transport?: "jxa" | "omnijs" | "cache" | "memory";
  };
}
```

The `suggestion` field is what makes errors _actionable_ (per `agent_systems.md`). Every typed error class has a default suggestion; tools override when they have better context.

## Mutation response contract

Every write tool (`task_create`, `task_update`, `task_complete`, `project_create`, …) returns the **full updated domain object** in `data`, not just an acknowledgment. This means agents never need a follow-up read after a write — the round-trip is self-contained. The only exception is destructive deletes, which return `{ deleted: true, id }` because the object no longer exists.

## Example: error for missing task

```json
{
  "error": {
    "code": "OF_NOT_FOUND",
    "message": "Task not found",
    "suggestion": "Confirm the ID with task_list or check whether the task was deleted. Use the persistent ID from OmniFocus, not a name.",
    "details": { "resource": "task", "id": "hPQ4RuKp9fW" }
  },
  "meta": { "correlationId": "01JBZK7PDR6XSYVMWT5YYVH8VQ", "durationMs": 12 }
}
```
