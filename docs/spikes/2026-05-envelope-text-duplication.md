# Envelope text-content duplication spike — May 2026

**Status:** ✅ DECISION — Option (b): keep `content[].text` but emit a tiny placeholder by default in v2; gate full-text via `OMNIFOCUS_LEGACY_TEXT_CONTENT=1` env flag for the v1 → v2 migration window.
**Issue:** [#793](https://github.com/torsday/omnifocus-mcp/issues/793)
**Decision recorded:** [ADR-0022](../adr/0022-envelope-text-content-duplication.md)

---

## The duplication

Every successful tool response goes on the wire **twice**:

```typescript
// src/envelope/index.ts:409
export function toolResponse(envelope: ToolEnvelope<unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
    structuredContent: envelope as unknown as Record<string, unknown>,
  };
}
```

`content[0].text` carries the JSON-serialized envelope. `structuredContent` carries the same envelope as a typed object. The MCP transport ships both fields. For a typical 2 KB envelope, the wire cost is ≈ 4 KB plus the small overhead of `content[]` framing.

Across the audit in epic [#770](https://github.com/torsday/omnifocus-mcp/issues/770), this is the single largest token lever: a roughly 2× multiplier on **every** successful response, dwarfing the per-field elision wins shipped in v1.3.0 ([#774](https://github.com/torsday/omnifocus-mcp/issues/774), 27–31% per workflow).

The duplication has a defensible historical reason — older MCP clients only read `content[]` — but the cost has compounded with the recent token-economy work and the duplicate is now visible in `responseStats` as roughly half the true cost (telemetry honesty bug, see "Telemetry implication" below).

## Survey: which clients read `content[]` vs `structuredContent`?

The MCP spec (CallToolResult schema, SDK v1.29) makes `content` required (defaults to empty array) and `structuredContent` optional. Behavior across the consumers we ship for or care about:

### `@modelcontextprotocol/sdk` v1.29 — typed-tool clients

Source verified at `node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js:485-520` and `…/server/mcp.js:182-207`.

| Path | Behavior |
|---|---|
| Tool **declares an `outputSchema`** | Server SDK validates `structuredContent` against the schema (throws if missing). Client SDK requires `structuredContent` (throws `McpError` if absent on a successful call) and validates against the same schema. `content[]` is *not* validated and is treated as cosmetic display text. |
| Tool **does not declare an `outputSchema`** | Neither side enforces `structuredContent`. Clients fall back to `content[].text` as the canonical payload. The text is the contract by default. |

omnifocus-mcp's tools currently **do not register `outputSchema`** — `grep -rn "outputSchema" src/tools` returns zero hits. So under the SDK's own contract, `content[].text` is the canonical payload for any client we don't control, and `structuredContent` is the *additional* typed view.

That changes the framing. We can't drop `content[].text` outright without breaking conformant clients; we can either (1) start declaring `outputSchema` per tool (a substantial separate effort that promotes `structuredContent` to first-class) and *then* prune the text, or (2) keep `content[]` non-empty but stop spending bytes on it.

### Concrete clients in the wild (best-effort survey)

| Client | Reads `content[].text`? | Reads `structuredContent`? | Notes |
|---|---|---|---|
| **Claude Desktop / Claude Code** (Anthropic SDK consumer) | Yes — surfaces text content to the model and to the user-visible tool-call display | Yes when present and tool has `outputSchema`; otherwise treats it as auxiliary | The model sees both fields in the tool-result block. Removing text without declaring `outputSchema` would degrade what the model sees. |
| **mcp-inspector** (`npx @modelcontextprotocol/inspector`) | Yes — the "Result" pane renders text content | Yes — separate "Structured" tab when present | Debugging tool. Both views matter for human inspection. |
| **opencode / Codex / Continue / generic stdio MCP clients** | Universally yes | Variable — adoption of the typed payload is uneven across third-party MCP frameworks as of mid-2026 | The `docs/clients/` set in this repo enumerates the supported clients; the `generic-stdio.md` integration guide assumes `content[]` works. |
| **Custom integrations reading raw JSON-RPC** | Yes (the spec says `content` is the canonical block list) | Sometimes — depends on whether the integration was built post-spec-revision-with-structuredContent | The MCP spec lists `structuredContent` as optional. Conformant new integrations should consume it, but legacy ones don't. |

**Verifiable signals:**

- The MCP SDK's own `CallToolResultSchema` makes `content` required with a default; `structuredContent` is `z.ZodOptional`. *(Verified.)*
- The SDK's *client* path enforces `structuredContent` only when the tool declares an `outputSchema`. *(Verified.)*
- omnifocus-mcp tools do not declare `outputSchema`. *(Verified — `grep -rn "outputSchema" src/tools` is empty.)*

**Inferred (cannot run the matrix end-to-end from inside this repo):**

- Behavior of specific third-party MCP frameworks (Cursor, Cline, custom LangChain/LangGraph adapters, etc.) under a placeholder `content[].text` — assumed to be "they display the placeholder verbatim and don't crash," but a real-deployment smoke test in v2.0.0 RC is the right place to confirm.

## Why option (b) wins

| Option | Wire reduction | Compatibility | Verdict |
|---|---|---|---|
| **(a) Drop `text` unconditionally** | ~50% | Breaks every client reading `content[].text` (the spec says it's the canonical payload absent `outputSchema`). Spec-conformant breakage. | ❌ Too aggressive without first promoting `structuredContent` to first-class via `outputSchema`. |
| **(b) Replace `text` with a placeholder + env-flag escape hatch** | ~50% with default; opt-in restoration via `OMNIFOCUS_LEGACY_TEXT_CONTENT=1` | Conformant: `content[]` is still present and non-empty. Clients that read text get a stable directive ("see structuredContent") rather than truncation. Operators with legacy clients flip one flag. | ✅ Recommended. Phased and reversible. |
| **(c) Keep duplicate; document why** | 0% | No change. | ❌ Token cost is the headline post-v1.3 lever; declining to act here forfeits the rest of #770. |
| **(d) Promote `structuredContent` via `outputSchema` per tool, then drop text** | ~50% eventually | Largest engineering effort (per-tool schemas); blocked on Zod → JSON Schema work; v2 can ship (b) sooner and revisit (d) in v2.x. | Future direction, not v2.0 scope. |

## Telemetry implication (in-scope for the spike PR)

`responseStats` ([#778](https://github.com/torsday/omnifocus-mcp/issues/778), shipped in v1.3.0) measures only `Buffer.byteLength(JSON.stringify(structuredContent))`. With the duplicate in place, the reported byte counts are roughly half the true wire cost. That's a telemetry-honesty bug regardless of which envelope option ships — operators currently see a number that under-reports actual token spend by ~2×.

**Fix scope for the spike PR:** measure the full wire size of the SDK result (`{ content, structuredContent }`) instead of just `structuredContent`. The `total` and percentile outputs become numerically larger but more accurate. No public-API change; the `responseStats` block on `internal_status` keeps the same shape.

After the v2 envelope change ships, the same measurement will continue to be correct — the placeholder text contributes a small constant per call (~24 bytes) and `structuredContent` carries the bulk.

## What ships in this PR

1. This spike note.
2. [ADR-0022](../adr/0022-envelope-text-content-duplication.md) — decision record for option (b), tagged Accepted.
3. ADR-0013 cross-reference to ADR-0022.
4. `responseStats` measurement corrected to full wire bytes (`src/server/middleware.ts`).
5. `docs/token-cost.md` updated to reflect the corrected measurement.
6. Test coverage for the new measurement.

## Out of scope (follow-up issue)

The actual envelope-shape change — placeholder `content[].text` + `OMNIFOCUS_LEGACY_TEXT_CONTENT` env flag + benchmark proving ≈2× reduction — is a v2.0.0 breaking change tracked separately. It depends on this ADR being Accepted.

## References

- [ADR-0011](../adr/0011-versioning-and-stability.md) — envelope changes are major-version bumps
- [ADR-0013](../adr/0013-tool-response-envelope.md) — uniform envelope contract
- [ADR-0015](../adr/0015-nl-excellence-response-envelope.md) — NL-excellence extensions to the envelope
- [#770](https://github.com/torsday/omnifocus-mcp/issues/770) — token-efficiency epic (parent)
- [#778](https://github.com/torsday/omnifocus-mcp/issues/778) — responseStats (telemetry surface being corrected)
- MCP SDK v1.29: `node_modules/@modelcontextprotocol/sdk/dist/esm/{client/index.js, server/mcp.js, types.d.ts}`
