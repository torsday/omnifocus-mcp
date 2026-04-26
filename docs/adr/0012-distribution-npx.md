# ADR-0012: Distribution via npx (npm package) as the v1 channel

**Date:** 2026-04-19
**Status:** Accepted

---

## Context

Users need to install the MCP server and configure a client (Claude Desktop, Claude Code, etc.) to launch it. The install UX is a first-impression gate: a three-step install with platform-specific quirks will be abandoned. Options for macOS tools in 2026:

1. **npx / npm global** — zero-install per-session or one-line global; the native Node.js distribution model
2. **Homebrew tap** — macOS-native; familiar to developers; requires maintaining a formula
3. **Claude Desktop Extension (DXT)** — one-click install via the Claude Desktop UI; format still stabilizing
4. **Prebuilt binaries** (`pkg`, `esbuild` + Node SEA) — no Node.js required on the user's machine; larger download
5. **Docker** — containerized; portable; wrong fit for a tool that talks to macOS-native apps

Each channel costs maintenance: release automation, version matrix, install documentation, regression testing. Picking too many at launch fragments effort.

## Decision

**v1 ships via npm as `@torsday/omnifocus-mcp`.** Primary invocation: `npx @torsday/omnifocus-mcp`. Secondary: `npm install -g @torsday/omnifocus-mcp` then `omnifocus-mcp`.

- Single-file bundle (`dist/index.js`) produced by `tsup --minify`
- Shebang `#!/usr/bin/env node`
- `bin` field in `package.json` mapping `omnifocus-mcp` to `dist/index.js`
- Prereqs: Node.js 24 or newer (documented; `npx` takes care of ensuring a compatible runtime for most users)

Other channels (Homebrew, DXT, prebuilt binaries) are deferred until there is a concrete user signal.

## Options Considered

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **npx / npm** | Native Node distribution; zero-install via npx; universal across macOS versions; Claude Desktop + Claude Code both support `npx` launch out of the box; single publish command | Requires Node.js on the user's machine (common for developers, less so for non-technical users) |
| Homebrew tap | macOS-idiomatic; users familiar with `brew install` | Maintaining a formula is additional work; updates lag; no concrete demand yet |
| Claude Desktop Extension (.dxt) | One-click install + automatic config injection | Format still stabilizing as of 2026; limits reach to Claude Desktop users only |
| Prebuilt binary | No Node.js prereq | Much larger artifact; SEA is still maturing; more complex CI; signing / notarization overhead for macOS |
| Docker | Uniform runtime | Wrong fit — container can't easily talk to macOS-native OmniFocus via JXA; breaks the point of the tool |

## Consequences

**Positive**

- `npx @torsday/omnifocus-mcp` is the one-line install that works in both Claude Desktop's `mcpServers` config and Claude Code's `claude mcp add`
- Releases are one `pnpm publish` away; no separate channel-specific pipelines
- Users can pin exact versions per client config
- Updates propagate: `npx` fetches the latest by default; users opt into pinning

**Negative**

- Users without Node.js must install it first (a one-time friction; most agent-tooling users already have Node)
- `npx`'s first run caches and downloads — a brief delay on first invocation per version
- No GUI install path for non-technical users (acceptable for a power-user tool; v1.1 can add DXT)

**Risks**

- **Users on older Node versions** (≤22) — the bundle targets Node 24; older versions fail loudly at startup with a version-mismatch error from npm's `engines` check. Documented in the per-client install guides.
- **npm outages** blocking npx fetch — rare; mitigated because cached versions continue to work offline
- **Package-name squatting** at `@torsday/omnifocus-mcp` — mitigated by publishing v0.0.1 as a placeholder before writing code (a Milestone 0 task)

## References

- `DESIGN.md` §23 — distribution & install
- npm `bin` convention — docs.npmjs.com
- MCP client configuration docs for Claude Desktop and Claude Code
