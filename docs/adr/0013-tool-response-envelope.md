# ADR-0013: Uniform tool response envelope with `data` / `meta` / `pagination` / `error`

**Date:** 2026-04-19
**Status:** Accepted

---

## Context

Every tool in this MCP returns a response to an LLM agent. The shape of that response is part of the public contract (per ADR-0011 "Versioning"); clients and agents build on it. Two mature patterns for that shape:

1. **Tool-specific shapes.** Each tool returns a payload with no common wrapper. Metadata (duration, correlation, cache hit) is implicit or absent.
2. **Uniform envelope.** Every response wraps the payload in a common shape carrying metadata, pagination, and — on failure — a typed error.

A third option is the MCP SDK's native content-blocks structure (`{ content: [{ type: "text", text: "…" }] }`). This is the MCP wire format for transport; it can carry our envelope as the JSON inside the text block, or we can let the content-block shape _be_ the envelope.

The choice is load-bearing because:

- Agents learn response shapes from examples; inconsistency confuses them
- Logs, traces, and observability hinge on metadata being present on every call
- Errors need `code` / `message` / `suggestion` / `details` discipline to be actionable (per `agent_systems.md`)
- Once the envelope is promised, changing it is a major version bump

## Decision

Every tool returns a **uniform JSON envelope** with four optional top-level fields:

```typescript
// Success
{
  data: T,              // tool-specific payload (required)
  meta: ResponseMeta,   // always present
  pagination?: {        // present on list-shaped tools only
    cursor: string | null,
    hasMore: boolean,
    total?: number
  }
}

// Failure
{
  error: {
    code: string,       // stable identifier from the error taxonomy
    message: string,
    suggestion?: string,
    details?: Record<string, unknown>
  },
  meta: ResponseMeta    // always present, even on failure
}

interface ResponseMeta {
  correlationId: string,
  durationMs: number,
  cacheHit: boolean,
  transport: "jxa" | "omnijs" | "cache" | "memory",
  ofVersion: string,
  warnings?: string[]
}
```

This JSON is serialized and returned as the text content of the MCP tool response (the MCP SDK handles the content-block wrapper transparently).

## Options Considered

| Option | Pros | Cons |
| ------ | ---- | ---- |
| Tool-specific shapes (no wrapper) | Minimum surface; every tool ships what it needs | Logs/traces lose metadata; errors lack structure; no uniform pagination; agents must re-learn per tool |
| **Uniform envelope** | Consistent metadata; typed error discipline; pagination is uniform; agent pattern-matching is easy; logs have provenance | Small constant overhead per response; new fields must be planned for stability |
| MCP content-blocks as the envelope | No JSON-inside-JSON | Content blocks are transport-shaped, not data-shaped; missing `meta`/`pagination`; error codes would have to live in text |
| Protobuf or MessagePack envelope | Compact | MCP is JSON-over-stdio; binary formats are hostile to debuggability and the ecosystem doesn't support them broadly |

## Consequences

**Positive**

- Every response carries `correlationId`, `durationMs`, `cacheHit`, `transport`, `ofVersion` — agent telemetry is uniform without per-tool work
- Pagination is identical across `task_list`, `project_list`, `search_query`, etc.; agents learn one pattern
- Errors are structured, machine-readable, and prescribe remediation via `suggestion`
- `meta.warnings` is the escape hatch for non-fatal issues (e.g. "this operation completed but modified more items than expected") without breaking success responses
- Adding a new `meta` field or a new pagination field is a minor version bump per ADR-0011

**Negative**

- Small constant per-call overhead (~100–200 bytes of JSON) — negligible relative to typical payload sizes
- Tool handlers must wrap their returns; mitigated by `ok(data)` and `err(code, message, ...)` helpers (DESIGN §12) that remove the boilerplate
- `meta.ofVersion` cannot be populated before the first live OF call; use `"unknown"` sentinel on cold-path errors

**Risks**

- **Field-name bikeshedding later** (e.g. "should it be `page` instead of `pagination`?") — mitigated by committing early in ADR form and treating any change as a semver major
- **Accidental omission of `meta`** by a handler — prevented by the `ok()` / `err()` helpers being the only path to produce responses; a lint rule can enforce no raw `return { data: … }` outside the helpers
- **Excessive `warnings` growth** — each warning contributes to context consumption; we log-level-gate or soft-cap warnings per response if necessary

## References

- `DESIGN.md` §12 — envelope shape in full with examples
- `ADR-0011-versioning-and-stability.md` — the envelope is explicitly part of the public contract
- `~/src/github.com/torsday/llm_prompts/agent_systems.md` — "rich responses" and "actionable errors" principles
