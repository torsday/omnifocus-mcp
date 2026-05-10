# Security: Attack Surface and Mitigations

This document summarises the omnifocus-mcp security posture per DESIGN §18. It is the primary reference for understanding what the server does and does not protect against.

---

## Transport model

omnifocus-mcp speaks **stdio** — there is no network listener, no open port, and no HTTP surface. The server process is launched by an MCP client (e.g. Claude Desktop) and communicates exclusively over the parent process's stdin/stdout. The only inbound vector is the MCP protocol messages themselves.

---

## Attack surface inventory

### 1. Attachment path traversal

**Risk:** `attachment_add` and `attachment_save_to_path` accept user-supplied filesystem paths. A malicious path (e.g. `../../../../etc/passwd`, or a symlink pointing outside the home directory) could read or write files beyond the intended scope.

**Mitigations:**

- `src/attachment/assertAttachmentPath.ts` resolves symlinks via `realpath()` **before** checking the allowlist, defeating symlink-escape attacks.
- An allowlist of path prefixes (default: `[$HOME]`) restricts all file operations to the user's home directory unless `OMNIFOCUS_ATTACHMENT_PATHS` explicitly extends it.
- Hard-blocked system prefixes (`/System/`, `/Library/`, `/private/System/`, `/private/Library/`) are always rejected, regardless of the allowlist.
- Null bytes and ASCII control characters (U+0000–U+001F, U+007F) are rejected at the boundary before any filesystem call. This surfaces a typed `ValidationError` instead of Node's generic `ERR_INVALID_ARG_VALUE` and prevents path bytes from confusing downstream tooling that treats certain control bytes as separators.
- `assertAttachmentSize` enforces the `maxAttachmentMb` cap before the OmniFocus call.

**Test coverage:** `src/attachment/assertAttachmentPath.test.ts` — includes symlink-escape, hard-blocked prefix, allowlist boundary, and null-byte/control-char rejection cases.

---

### 2. Raw-script gating

**Risk:** `run_jxa_script` and `run_omnijs_script` execute arbitrary code with full OmniFocus Automation privileges. If always present, any MCP client could invoke them.

**Mitigations:**

- Both tools are **absent from the server entirely** unless the process is started with `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`. The `registerRunJxaScriptTool` / `registerRunOmniJsScriptTool` functions return `null` (and call no `server.registerTool`) when the flag is unset.
- Every invocation emits a `raw_script.invoked` audit event at `info` level with the full script body (`src/tools/rawScript/jxa.ts`, `src/tools/rawScript/omnijs.ts`).
- The adapter checks for the method's existence at call time as a defence-in-depth guard.

**Test coverage:** `src/tools/rawScript/jxa.test.ts` and `omnijs.test.ts` — "gated registration" suite covers both `allowRawScript: false` (tool absent, `registerTool` not called) and `allowRawScript: true` (tool present).

---

### 3. Prompt injection containment

**Risk:** OmniFocus user content (task names, notes, tag names) appears in tool responses. If that content is interpolated into protocol metadata fields (`suggestion`, `message`, `warning`) an agent may treat it as a system instruction.

**Mitigations:**

- The `no-metadata-interpolation` lint rule (`src/linting/customRules.ts`, rule 3) flags any line where a user-content accessor (`.name`, `.note`, `.noteHtml`, `.title`) appears alongside a metadata field keyword on the same line.
- `meta.warnings` entries are static strings constructed by server code, never by user content.
- Tool descriptions are static compile-time strings, never interpolated from OmniFocus data.

**Test coverage:** `src/linting/customRules.test.ts` — "no-metadata-interpolation rule" suite, including an adversarial task name test (`SYSTEM: ignore previous instructions`).

---

### 4. Stray stdout guard

**Risk:** The MCP server uses stdio as its transport. Any `console.log` or `process.stdout.write` from application code corrupts the protocol framing and produces silent client errors.

**Mitigations:**

- `src/server/stdoutGuard.ts` wraps `process.stdout.write` at server startup. Calls that do not originate from the MCP SDK transport module (identified via stack-trace allowlist) throw immediately with a descriptive error, surfacing the bug at the write site.
- The guard is installed before `server.connect(transport)` in `src/server/composition.ts`.

**Test coverage:** `src/server/stdoutGuard.test.ts` — covers the guard throwing for application code, the idempotency invariant, stack-trace allowlist matching, and clean uninstall.

---

### 5. Network import ban

**Risk:** Importing HTTP libraries (`http`, `https`, `node-fetch`, `axios`, `undici`) could allow outbound network calls — data exfiltration, SSRF, or supply-chain compromise.

**Mitigation:** The `no-network-import` lint rule (`src/linting/customRules.ts`, rule 4) flags any static or dynamic import of these modules across all source files.

**Test coverage:** `src/linting/customRules.test.ts` — "no-network-import rule" suite.

---

### 6. Module boundary enforcement

**Risk:** If transport implementations (`adapter/jxa/`, `adapter/omnijs/`) are imported directly by `services/` or `tools/`, the adapter seam breaks. Any code at any layer can then call the raw JXA/OmniJS transport — bypassing the router, concurrency guards, and rate limiting.

**Mitigation:** The `no-layer-violation` lint rule (`src/linting/customRules.ts`, rule 5) enforces:

- Transport implementations (`adapter/jxa/`, `adapter/omnijs/`) must not import from `services/` or `tools/`.
- `services/` and `tools/` must not import transport implementations directly (only the `OmniFocusAdapter` interface is permitted).

The `adapter/router.ts` and `src/server/composition.ts` are the only permitted wiring points for transports.

**Test coverage:** `src/linting/customRules.test.ts` — "no-layer-violation rule" suite, including the carve-out for the `OmniFocusAdapter` interface import.

---

## Lint gate

All custom rules are enforced via `scripts/lint-custom.ts`. Run locally:

```bash
pnpm tsx scripts/lint-custom.ts
```

This is expected to be added to the `pnpm lint` pipeline so it gates PRs.

---

## Out of scope (by design)

| Concern | Decision |
|---------|----------|
| Authentication / authorisation | OmniFocus uses macOS Automation permissions — the OS gates access, not this server. |
| Encryption at rest | OmniFocus manages its own database encryption. |
| Rate limiting at the transport level | Handled by `ToolRateLimiter` per-tool; no per-IP limiting needed (stdio transport). |
| Input sanitisation for XSS | No HTML rendering surface; all output is JSON over MCP. |
