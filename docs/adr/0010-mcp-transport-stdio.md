# ADR-0010: stdio as the sole MCP transport for v1

**Date:** 2026-04-19
**Status:** Accepted

---

## Context

MCP supports multiple transports: **stdio** (child-process model, one client, strong lifecycle), **SSE** (HTTP streaming, multiple clients, weaker lifecycle), and emerging **HTTP streaming** variants. Transport choice affects install UX, threat model, multi-client capability, and client compatibility.

`omnifocus-mcp` is a single-user local tool. OmniFocus itself is desktop-bound; no aspect of our use case benefits from a remote connection today.

The deferred-decision trap: launch supporting all three transports "for flexibility." Every transport brings its own lifecycle, auth story, deployment model, and test surface. Premature transport diversity is complexity without user benefit.

## Decision

**v1 ships stdio only.** SSE and HTTP transports are deferred until a concrete user need appears.

- The server is a child process of the MCP client (Claude Desktop, Claude Code, etc.)
- Lifecycle is owned by the client: client starts, client kills
- Authentication is implicit (process-level): if you can spawn the process, you can use it
- Input on stdin, structured events on stdout, logs on stderr

## Options Considered

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **stdio only** | Simplest install (npx or bin); matches Claude Desktop and Claude Code defaults; no auth complexity; no network surface | One client per server instance; no remote access; requires the client to manage lifecycle |
| SSE only | Remote-capable; multiple clients possible | Requires an HTTP server; auth model needed; installation is a daemon, not a child process; doesn't fit local-only use case |
| stdio + SSE (both) | Flexible | Two codepaths for transport; two lifecycle models; test surface doubled; confusion about which to use |
| Custom transport (e.g. Unix socket) | Local + multi-client | Doesn't match any MCP client's default; extra integration friction for users |

## Consequences

**Positive**

- Install is trivial: `npx @torsday/omnifocus-mcp`; client does the rest
- No network surface → no inbound attack surface; auditable by observation
- stderr is free for logs because stdout is dedicated to MCP
- Lifecycle is deterministic: process alive ↔ server alive; dead simple for users to reason about
- Matches the default expectation of every major MCP client in 2026

**Negative**

- Only one connected client at a time per server instance — users running both Claude Desktop and Claude Code pointing at the same MCP get two instances (two independent caches, two independent circuit states). Acceptable at single-user scale.
- Remote use is not possible — users on a different machine can't consume the same OF via this server. Deferred.

**Risks**

- **User demand for remote access** — low probability at our scale; if it appears, we add an SSE transport as a minor version bump (stdio remains the default). Non-breaking because transport is chosen by how the client invokes us.
- **Client lifecycle bugs** (client crashes, orphan server processes) — mitigated by the server watching for stdin EOF and exiting gracefully.
- **Multi-MCP-client usage** (user has both Claude Desktop and Claude Code using this MCP) → two instances contending for OF. Each instance serializes its own writes, but cross-instance consistency is OF's concern. Acceptable; OF handles concurrent automation requests fine.

## References

- `DESIGN.md` §17 — lifecycle; §23 — distribution
- MCP specification — transport mechanisms
- `SPEC.md` — out of scope: remote transports
