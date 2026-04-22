# Claude Code — omnifocus-mcp setup

Adds omnifocus-mcp as a local MCP server in Claude Code (the CLI).

## Prerequisites

- macOS 13 (Ventura) or later
- OmniFocus 3.15+ or OmniFocus 4.x
- Node.js 20 LTS or 22 LTS (`node --version`)
- Claude Code installed (`claude --version`)

## One-time install

```bash
npm install -g @torsday/omnifocus-mcp
```

Verify the binary is available:

```bash
omnifocus-mcp --version
```

## Register the server

Run once to add the server to Claude Code's MCP configuration:

```bash
claude mcp add omnifocus omnifocus-mcp
```

To verify it was registered:

```bash
claude mcp list
```

You should see `omnifocus` in the output.

## Start a session

```bash
claude
```

The `omnifocus` server starts automatically. In the session, type:

> Use the internal_status tool and tell me what it returns.

A healthy response looks like:

```json
{
  "data": {
    "status": "ok",
    "ofVersion": "4.5.2",
    "transport": "jxa"
  },
  "meta": { ... }
}
```

## macOS Automation permission

The first `osascript` call triggers a macOS Automation permission prompt:

> **"Terminal" would like to control "OmniFocus"**

Click **OK**. If you accidentally denied it, re-grant it in:

**System Settings → Privacy & Security → Automation → Terminal → OmniFocus** ✓

## Optional environment variables

Pass environment variables with `-e` flags:

```bash
claude mcp add omnifocus omnifocus-mcp \
  -e OMNIFOCUS_LOG_LEVEL=debug \
  -e OMNIFOCUS_CACHE_TTL_MS=60000
```

Or edit the generated config (`~/.claude.json` or project `.claude/mcp.json`) directly:

```json
{
  "mcpServers": {
    "omnifocus": {
      "command": "omnifocus-mcp",
      "args": [],
      "env": {
        "OMNIFOCUS_LOG_LEVEL": "info"
      }
    }
  }
}
```

| Variable | Default | Purpose |
|---|---|---|
| `OMNIFOCUS_LOG_LEVEL` | `info` | Log verbosity: `trace` / `debug` / `info` / `warn` / `error` |
| `OMNIFOCUS_CACHE_TTL_MS` | `30000` | Read-cache TTL in milliseconds |
| `OMNIFOCUS_READ_GRACE_MS` | `5000` | Grace window for in-flight reads on shutdown |
| `OMNIFOCUS_WRITE_GRACE_MS` | `10000` | Grace window for in-flight writes on shutdown |
| `OMNIFOCUS_ALLOW_RAW_SCRIPT` | — | Set to `1` to enable `run_jxa_script` / `run_omnijs_script` escape hatches |

## Remove the server

```bash
claude mcp remove omnifocus
```

## Troubleshooting

**`OF_NOT_RUNNING` error**
- Launch OmniFocus before starting a session that uses the server.

**`OF_PERMISSION_DENIED` error**
- Re-grant the Automation permission (see above).

**Check server status inside a session**

```
/mcp
```

Claude Code shows all registered MCP servers and their connection state.
