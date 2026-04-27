# Pi (pi.ai) — omnifocus-mcp compatibility

[Pi](https://pi.ai) is a conversational AI assistant by Inflection AI. This page records its current MCP compatibility status so you don't spend time chasing a setup that doesn't exist yet.

## Current status: not supported

Pi does not support the Model Context Protocol as of mid-2025. The consumer-facing app has no mechanism to connect to external tool servers — MCP or otherwise. There is no known bridge or proxy approach that adds MCP support to Pi.

Pi's tool surface is limited to:

- Web browsing via curated Discover Feeds
- Voice interaction
- A preference graph that personalises conversation style

It does not support code execution, calendar or app integrations, or custom tool servers.

## What to use instead

If you want an AI assistant that connects to omnifocus-mcp, use any of the clients in this directory:

| Client | Setup guide |
|---|---|
| Claude Code (CLI) | [claude-code.md](./claude-code.md) |
| Claude Desktop | [claude-desktop.md](./claude-desktop.md) |
| OpenCode | [opencode.md](./opencode.md) |
| OpenAI Codex CLI | [codex.md](./codex.md) |
| Any other MCP-compatible stdio client | [generic-stdio.md](./generic-stdio.md) |

## Tracking MCP support in Pi

Inflection has published MCP servers for their enterprise products (Inflection for Business), but those are servers *for* Claude and ChatGPT to call — they do not give Pi itself the ability to call external MCP servers.

Watch [pi.ai/updates](https://pi.ai) and [Inflection's engineering blog](https://inflection.ai) for announcements. If support ships, the setup will follow the [generic stdio pattern](./generic-stdio.md) — `command: omnifocus-mcp`, no required args.
