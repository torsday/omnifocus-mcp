# Security policy

## Reporting a vulnerability

If you believe you've found a security vulnerability in `@torsday/omnifocus-mcp`, **please do not file a public GitHub issue**. Instead:

- Open a [GitHub Security Advisory](https://github.com/torsday/omnifocus-mcp/security/advisories/new) on this repository (preferred — gives us a private channel and a CVE workflow)

Please include:

- A short description of the issue and its impact
- Steps to reproduce, or a minimal proof-of-concept
- The version of `@torsday/omnifocus-mcp` (`omnifocus-mcp --version`) and your Node.js + macOS versions
- Whether you've shared the finding with anyone else

I aim to acknowledge new reports within a few days and to land a fix or mitigation before any public disclosure. Coordinated disclosure is appreciated.

## Scope

In scope:

- The published npm package `@torsday/omnifocus-mcp` and its bundled `dist/index.js`
- The MCP tool surface and its inputs (e.g. injection through tool arguments, schema bypasses, path traversal in `attachment_*` tools)
- The opt-in raw-script tools (`run_jxa_script`, `run_omnijs_script`) — inappropriate enablement is a configuration concern; an exploitable bypass of the `OMNIFOCUS_ALLOW_RAW_SCRIPT` gate is in scope
- The stdout guard (any byte that escapes to stdout corrupts MCP framing)

Out of scope:

- Vulnerabilities in OmniFocus itself, JXA, OmniJS, or `osascript` — please report those to Omni Group
- Vulnerabilities in `@modelcontextprotocol/sdk`, `pino`, `lru-cache`, `zod`, or other transitive dependencies — please report upstream; this project will pick up the fix once published
- Issues that require local, root-equivalent access to the user's machine to exploit
- Anything that requires an MCP client to deliberately misbehave (the threat model assumes the client is trusted)

## Security posture summary

- No network I/O — enforced by a lint rule that forbids `http`, `https`, `node-fetch`, `axios`, `undici` imports
- No stdout writes outside the MCP framing path — enforced by `installStdoutGuard()` and an integration test
- Attachment paths validated against `OMNIFOCUS_ATTACHMENT_PATHS` (default `$HOME`); symlink-escape protection in `assertAttachmentPath`
- Raw-script tools (`run_jxa_script`, `run_omnijs_script`) require explicit opt-in via `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`; every invocation is audit-logged
- User content (task names, notes, tag names) never appears in protocol metadata fields (`suggestion`, `error.message`, `meta.warnings`) — enforced by the `no-metadata-interpolation` custom lint rule
- Config secrets are redacted from the `server.started` log event

See [`docs/design/security.md`](./docs/design/security.md) for the full threat model.
