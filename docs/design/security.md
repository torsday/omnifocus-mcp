<!-- Originally DESIGN.md §18 (split per #805) -->

# Security posture

Threat model: a single user running the MCP server locally. The adversary is not a remote attacker (there's no network surface) but rather a **misbehaving or prompt-injected agent**. The blast radius is the user's OmniFocus data and the user's home directory.

## Controls

| Control                              | Enforcement                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| No network I/O from server           | Lint rule bans `http`, `https`, `fetch`, `node-fetch`, `axios`, `undici`; CI fails on import   |
| No stdout writes (MCP uses stdio)    | Startup hooks `process.stdout.write` to fail loudly; integration test asserts zero bytes out   |
| Attachment paths scoped              | Default allowlist `$HOME`; target path resolved via `fs.realpathSync` **before** allowlist check to prevent symlink escape; rejected paths return `ValidationError` with reason |
| Raw-script tools off by default      | Only registered when `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`; loudly flagged; every call audit-logged  |
| No PII in `info` logs                | Structured logger redacts `name`, `note`, `noteHtml`, `tagNames` at `info`+; only `debug`-     |
| No secret storage                    | The server owns no secrets; OmniFocus auth is OF's concern                                     |
| Least-privilege macOS Automation     | Permission is requested for OmniFocus only; no other app; documented in the install flow      |
| Timeouts on every OF call            | JXA 30s, OmniJS 45s; prevents a wedged OF from holding resources indefinitely                  |
| Circuit breakers                     | Per-tool, 3 failures / 60s; reject fast rather than cascading failures                         |
| Rate limits                          | Per-tool 120/60s default; opt-out via env for integration-test runs                            |
| Raw script argument escaping         | We pass a single JSON argument to each JXA script; no shell-string interpolation anywhere      |
| Prompt injection containment         | Task names, notes, and tag names from OmniFocus are treated as untrusted content. They are never interpolated into `suggestion`, `message`, `warning`, or other protocol/metadata fields — only placed inside the typed `data` payload where the agent expects user content. |

## Non-goals (v1)

- No sandboxing of JXA/OmniJS scripts (impractical; OF's scripting is inherently privileged)
- No capability tokens per tool call (single-user; unnecessary complexity)
- No audit log persistence beyond stderr (operator can capture stderr to file)
