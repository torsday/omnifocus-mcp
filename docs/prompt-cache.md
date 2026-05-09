# Prompt-cache determinism contract

Anthropic's prompt cache reuses static prefixes byte-for-byte across sessions
within a 5-minute window. Cached tokens cost ~10× less than uncached ones, so
any LLM client that reuses this MCP server within that window pays for the
static prefix once if (and only if) the prefix is byte-identical between
sessions.

The MCP `tools/list` response — full JSON Schema + descriptions for every
registered tool — is the **largest static prefix this server emits**, paid by
every session at handshake. The descriptions alone account for tens of KiB of
text; the schemas add another large chunk.

This document is the **determinism contract** for that response. Any change
that breaks it silently doubles the prompt-cache cost for every client of this
server, so the contract is enforced by tests in two tiers:

- **In-process** — `src/server/mcpServer.test.ts` (`tools/list determinism (#772)`).
  Catches drift inside the SDK serializer and `zod-to-json-schema`.
- **Cross-process** — `tests/e2e/determinism.test.ts`. Boots the bundled
  server twice in fully separate child processes and byte-diffs the raw
  `tools/list` JSON-RPC response. Gated on `OMNIFOCUS_E2E=1`.

## What "deterministic" means here

The contract is byte-stability of the JSON-RPC `result` payload across two
fresh boots of the same build, on the same Node version, with the same env.
Cross-version stability (e.g. across releases of this server, or across Node
majors) is **out of scope** — the cache TTL is 5 minutes and the cache is
per-prefix, so a deploy that changes the prefix simply pays the cache miss
once per client, not per session.

## Why it's currently stable

Two pieces produce the response:

1. **Tool ordering** — `Object.entries(this._registeredTools)` in the MCP
   SDK iterates in V8 string-key insertion order. Insertion order is set by
   the sequence of `register*Tool(server, ctx)` calls in
   `src/server/mcpServer.ts::startServer`. That sequence is fixed in source
   and has no dependency on `process.env`, `Date.now`, or any iteration over
   `Set` / `Map` containers built from non-deterministic input. Add new
   tools by appending registrations or inserting them in a deliberate
   position — never iterate a `Map` you built from `Object.keys` after
   sorting by something runtime-derived.

2. **Per-tool schema serialization** — `zod-to-json-schema` (the v3 path
   the SDK uses for our schemas) walks the Zod tree depth-first and emits
   keys in a fixed order. Recursive schemas (`TaskPredicate`,
   `PerspectiveRuleInput`) are registered against `z.globalRegistry` with
   stable string IDs (see #717), so the `$ref` strings are deterministic.

## How to keep it stable

When adding a new tool or changing an existing one, anything that would
affect the `tools/list` payload should pass these checks:

- **Don't iterate `Set` / `Map` whose insertion order depends on runtime
  input.** If you build a registry from `Object.keys(env)`, sort first.
- **Don't include `Date`, `process.pid`, or random IDs in descriptions or
  schemas.** That includes default values and example fields.
- **Don't change `OMNIFOCUS_ALLOW_RAW_SCRIPT` semantics in a way that
  conditionally reorders other registrations.** The two raw-script tools
  appear at the end of `startServer`'s registration block precisely so
  toggling the flag only adds/removes a stable suffix.
- **Recursive schemas need a registry ID.** Register them with
  `schema.register(z.globalRegistry, { id: "<StableName>" })` — the ID is
  what the `$ref` string contains, and an unstable ID would break
  determinism even with deterministic walk order.

## When the contract is allowed to change

Adding a tool or changing a description is fine — clients pay the
prompt-cache miss once per release. The contract guards **stability within
a build**, not stability across releases.

If a future change makes the byte-stability test infeasible (e.g. a tool
that genuinely needs runtime-derived schema fields), that is an ADR
conversation: either accept the cache cost or design the dynamic part out
of the static prefix (e.g. expose it via a resource instead of a tool
schema).

## Verifying locally

```sh
# In-process — fast, no build needed.
pnpm test src/server/mcpServer.test.ts

# Cross-process — requires the bundle.
pnpm build
OMNIFOCUS_E2E=1 pnpm exec vitest run tests/e2e/determinism.test.ts
```

Both suites assert byte-identical output and a stable SHA-256 of the first
4 KiB of the response (the prompt-cache-relevant prefix).
