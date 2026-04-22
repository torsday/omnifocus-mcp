# Claude Desktop — omnifocus-mcp setup

Adds omnifocus-mcp as a local MCP server in Claude Desktop.

## Prerequisites

- macOS 13 (Ventura) or later
- OmniFocus 3.15+ or OmniFocus 4.x
- Node.js 20 LTS or 22 LTS (`node --version`)
- Claude Desktop (latest)

## One-time install

```bash
npm install -g @torsday/omnifocus-mcp
```

Verify the binary is available:

```bash
omnifocus-mcp --version
```

## Configuration

Open (or create) `~/Library/Application Support/Claude/claude_desktop_config.json` and add the `omnifocus-mcp` entry to `mcpServers`:

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

If Claude Desktop is already running, **quit and relaunch** it. The server starts automatically when Claude opens.

## Verify it works

In a new Claude conversation, type:

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

Add any of these to the `env` block in `claude_desktop_config.json`:

| Variable | Default | Purpose |
|---|---|---|
| `OMNIFOCUS_LOG_LEVEL` | `info` | Log verbosity: `trace` / `debug` / `info` / `warn` / `error` |
| `OMNIFOCUS_CACHE_TTL_MS` | `30000` | Read-cache TTL in milliseconds |
| `OMNIFOCUS_READ_GRACE_MS` | `5000` | Grace window for in-flight reads on shutdown |
| `OMNIFOCUS_WRITE_GRACE_MS` | `10000` | Grace window for in-flight writes on shutdown |
| `OMNIFOCUS_ALLOW_RAW_SCRIPT` | — | Set to `1` to enable `run_jxa_script` / `run_omnijs_script` escape hatches |

## Troubleshooting

**Claude says the tool isn't available**
- Confirm the server appears under `Settings → Developer → MCP Servers` in Claude Desktop.
- Quit and relaunch Claude Desktop after any config change.

**`OF_NOT_RUNNING` error**
- Launch OmniFocus before starting a conversation that uses the server.

**`OF_PERMISSION_DENIED` error**
- Re-grant the Automation permission (see above).

**Logs**
- Claude Desktop logs: `~/Library/Logs/Claude/`
- Server stderr (if configured): watch with `tail -f ~/Library/Logs/Claude/mcp-server-omnifocus.log`
