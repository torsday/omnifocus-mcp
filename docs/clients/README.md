# docs/clients/

Client integration guides for omnifocus-mcp. All clients use the **stdio transport** — omnifocus-mcp is a local process, not a hosted server.

Listed by adoption, with Claude Code first. Alphabetical within tiers.

| Client | Guide | Transport | Notable |
|---|---|---|---|
| Claude Code | [claude-code.md](./claude-code.md) | stdio | Project-local config in `.claude/`; supports per-repo MCP server lists |
| Claude Desktop | [claude-desktop.md](./claude-desktop.md) | stdio | Global config in `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Codex CLI | [codex.md](./codex.md) | stdio | OpenAI Codex CLI; YAML-based `~/.codex/config.yaml` |
| OpenCode | [opencode.md](./opencode.md) | stdio | Open-source terminal agent by SST; `opencode.json` or `~/.config/opencode/config.json` |
| Pi | [pi.md](./pi.md) | — | MCP not supported as of mid-2025; page explains why |

If your client isn't listed, see [generic-stdio.md](./generic-stdio.md) — it documents the underlying stdio contract any MCP-compatible client can use.

**Claude Code vs Claude Desktop:** both run the same server over stdio. The difference is config location: Claude Code is project-local (`.claude/`), Claude Desktop is global (`claude_desktop_config.json`). Prefer Claude Code for per-repo server isolation.
