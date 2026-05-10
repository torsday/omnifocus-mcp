# ADR-0022: Envelope `content[].text` becomes a placeholder; full envelope lives on `structuredContent`

**Date:** 2026-05-10
**Status:** Accepted

---

## Context

Every successful tool response wraps a `ToolEnvelope` (defined in [ADR-0013](./0013-tool-response-envelope.md), extended in [ADR-0015](./0015-nl-excellence-response-envelope.md)) and emits it on the wire **twice**: once as `content[0].text = JSON.stringify(envelope)`, and once as `structuredContent: envelope`. The MCP transport ships both fields. For a typical 2 KB envelope the wire cost is ≈ 4 KB.

The duplication exists for a defensible historical reason — the MCP spec makes `content[]` required and treats it as the canonical payload for any tool that does not declare an `outputSchema` (verified at SDK v1.29 `client/index.js:485-520` and `server/mcp.js:182-207`). omnifocus-mcp tools currently do not declare `outputSchema`, so under the SDK's contract `content[].text` is what conformant clients consume. `structuredContent` is the *additional* typed view, opt-in.

The cost has compounded with the v1.3.0 token-economy work ([#774](https://github.com/torsday/omnifocus-mcp/issues/774), 27–31% per-workflow elision). Per the audit in epic [#770](https://github.com/torsday/omnifocus-mcp/issues/770), the duplicate is the single largest remaining lever — a roughly 2× multiplier on every successful response. The spike at `docs/spikes/2026-05-envelope-text-duplication.md` (issue [#793](https://github.com/torsday/omnifocus-mcp/issues/793)) surveyed the consumer matrix and the SDK source to scope the choice.

This ADR records the chosen direction. Implementation lands in a separate v2.0.0 PR.

## Decision

`content[].text` defaults to a small fixed placeholder. Full envelope text is opt-in via an environment variable.

```typescript
// Default (v2.0.0+):
{
  content: [{ type: "text", text: "see structuredContent" }],
  structuredContent: envelope,  // full ToolEnvelope (unchanged)
}

// With OMNIFOCUS_LEGACY_TEXT_CONTENT=1 (legacy v1.x parity):
{
  content: [{ type: "text", text: JSON.stringify(envelope) }],  // full body
  structuredContent: envelope,
}
```

Specifically:

1. **`structuredContent` is unchanged.** The full `ToolEnvelope` (`data` / `meta` / `pagination` / `error` / `hints` / `clarification`) continues to ride on `structuredContent` exactly as ADR-0013 and ADR-0015 specify. Clients consuming the typed payload see no shape change and no semantic change.
2. **`content[]` remains required and non-empty.** The MCP spec makes `content` required (`z.ZodDefault<…array…>`); clients that pattern-match on the array's existence keep working. The single text block carries the directive `"see structuredContent"` — short, stable, English, opaque.
3. **`OMNIFOCUS_LEGACY_TEXT_CONTENT=1` opt-in restores v1.x behavior.** Operators with downstream clients that haven't migrated to consume `structuredContent` flip one env var; the full JSON returns to `content[].text`. The flag is read once at server start (matching the existing `OMNIFOCUS_*` env-flag pattern; see `src/config/env.ts`) and applied uniformly to every response. No per-tool gating.
4. **Versioning.** The default behavior change is a major-version bump per [ADR-0011](./0011-versioning-and-stability.md). It ships as **v2.0.0**. The env flag is the migration window: legacy operators keep v1.x parity by setting the flag; everyone else gets the ~50% wire reduction by default.

## Options Considered

| Option | Pros | Cons |
|---|---|---|
| **(a) Drop `text` unconditionally** — `content: []` or `content: [{ type: "text", text: "" }]` | Maximum wire reduction; cleanest contract going forward | Breaks every client that reads `content[].text` as the canonical payload — which the MCP spec says is the canonical path absent `outputSchema`. Spec-conformant breakage on existing integrations. No reversibility window. |
| **(b) Placeholder text + `OMNIFOCUS_LEGACY_TEXT_CONTENT` opt-in** — chosen | Same wire reduction as (a) for default deployments; `content[]` remains non-empty so spec-conformant clients keep working with a stable directive; one-flag escape hatch for legacy holdouts; reversible during the migration window | Three new lines of code in `toolResponse()`; one new env flag in the matrix; placeholder string is itself a tiny contract (must not change once published) |
| **(c) Keep duplicate; document why** | Zero risk | Forfeits the largest token lever in the audit; `responseStats` honesty bug remains a wart; epic [#770](https://github.com/torsday/omnifocus-mcp/issues/770) loses its headline |
| **(d) Promote `structuredContent` to first-class via per-tool `outputSchema`, then drop text** | Aligns with the SDK's canonical typed-tool pattern; future-proof | Substantial separate effort (Zod ↔ JSON Schema for ~80 tools, contract tests for each); v2 can ship (b) now and revisit (d) in v2.x once Zod-to-schema tooling matures. Sequenceable, not exclusive. |

(d) is a future direction, not a competing option for v2.0. (b) does not preclude shipping (d) later — once every tool has an `outputSchema`, the placeholder can be shortened further or `content[]` can shrink to an empty array.

## Consequences

**Positive**

- **~50% wire-byte reduction on every successful response** for default v2 deployments. Multiplies the per-field elision wins (#774) rather than competing with them.
- `responseStats` reports honest numbers post-v2 — full wire size, not half. Operators see real cost.
- Migration friction is minimized: one env flag for legacy operators; no API-shape change for typed-content consumers.
- `structuredContent` is unchanged, so consumers that already read the typed payload (Anthropic SDK with `outputSchema`-enabled tools, mcp-inspector's "Structured" tab, custom integrations following the v1.x post-spec-revision conventions) see exactly the same data.
- The placeholder string is short enough (~24 bytes) that it never dominates the response — the cost stays in `structuredContent` where the agent actually reads it.

**Negative**

- v2.0.0 is a breaking-change release. Release notes, migration guide, and `OMNIFOCUS_LEGACY_TEXT_CONTENT` documentation are required before tagging.
- Clients that *display* `content[].text` to users (e.g. Claude Desktop's tool-call display, some custom UIs) will show "see structuredContent" instead of a JSON dump unless the operator flips the flag. For most operators this is a wash — the JSON dump was rarely human-readable anyway — but it's a visible behavior change.
- The placeholder string is now a contract. Renaming it (e.g. `"see structuredContent"` → `"omnifocus-mcp: typed payload on structuredContent"`) is itself a breaking change. We commit to the short form here.
- Operators running with `OMNIFOCUS_LEGACY_TEXT_CONTENT=1` keep paying the v1 cost, so cost reductions in production only realize as the ecosystem migrates.

**Risks**

- **Risk:** A consumer relies on `JSON.parse(content[0].text)` and silently gets garbage on v2. *Mitigation:* the migration guide calls this out as the #1 v2 breaking change with a copy-pasteable detection snippet (`if (!result.structuredContent) throw …`); the env flag is the immediate workaround.
- **Risk:** Anthropic's tool-result rendering depends on `content[].text` for the user-visible echo. *Mitigation:* Claude Desktop and Claude Code already render `structuredContent` when present; the placeholder is what the user sees in the *fallback* path, which is rare for any tool a Claude consumer hits. If field reports show otherwise, operators flip the flag while we revisit.
- **Risk:** A future spec revision deprecates `content[]` or `structuredContent`. *Mitigation:* both are in the spec as of mid-2026; any change is a multi-quarter migration with its own upgrade ADR.
- **Risk:** Drift between the placeholder string and what migration docs say. *Mitigation:* the string is a single named constant in `src/envelope/index.ts`; the migration doc imports / cross-references the constant rather than restating the literal.

## References

- [ADR-0011](./0011-versioning-and-stability.md) — envelope shape changes are major-version bumps
- [ADR-0013](./0013-tool-response-envelope.md) — uniform envelope; this ADR extends the wire-format decision
- [ADR-0015](./0015-nl-excellence-response-envelope.md) — `hints` / `clarification` / `humanReadableSummary` extensions; ride on `structuredContent` and are unaffected
- [#770](https://github.com/torsday/omnifocus-mcp/issues/770) — token-efficiency epic (parent)
- [#778](https://github.com/torsday/omnifocus-mcp/issues/778) — `responseStats` telemetry surface
- [#793](https://github.com/torsday/omnifocus-mcp/issues/793) — this spike
- `docs/spikes/2026-05-envelope-text-duplication.md` — survey + decision rationale
- `src/envelope/index.ts:409` — `toolResponse()` (the call site that grows the env-flag branch in the implementation PR)
- `src/server/middleware.ts:122` — `responseStats` byte measurement (corrected in this PR; honest under either flag setting)
