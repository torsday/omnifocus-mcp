# OpenCode — omnifocus-mcp setup

Adds omnifocus-mcp as a local MCP server in [OpenCode](https://opencode.ai), the open-source terminal agent by SST.

## Prerequisites

- macOS 13 (Ventura) or later
- OmniFocus 3.15+ or OmniFocus 4.x
- Node.js 24 or newer (`node --version`)
- OpenCode installed (`opencode --version`)

## One-time install

```bash
npm install -g @torsday/omnifocus-mcp
```

Verify the binary is available:

```bash
omnifocus-mcp --version
```

## Configuration

OpenCode reads MCP server definitions from `~/.config/opencode/opencode.json` (global) or a project-local `opencode.json` in the working directory. Add an entry under `"mcp"`:

```json
{
  "mcp": {
    "omnifocus": {
      "type": "local",
      "command": ["omnifocus-mcp"],
      "environment": {
        "OMNIFOCUS_LOG_LEVEL": "info"
      },
      "enabled": true
    }
  }
}
```

If the file does not exist, create it. If it does exist, merge the `"mcp"` key — don't replace other server entries.

The `"type": "local"` field is required for stdio servers. The `"command"` array takes the executable name followed by any arguments (none required for omnifocus-mcp).

## Verify

Restart OpenCode (it reads the config at startup), then ask:

> Use the `internal_status` tool and tell me what it returns.

A healthy response surfaces a JSON object with `status: "ok"`, `ofVersion`, and `transport`. If no tools are found, see [Troubleshooting](#troubleshooting).

## Grant macOS Automation permission

On the first call that touches OmniFocus, macOS prompts:

> "**OpenCode** (or your terminal) wants access to control **OmniFocus**."

Click **OK**. If denied by mistake:

**System Settings → Privacy & Security → Automation → [your terminal app] → OmniFocus** ✓

Because OpenCode is a terminal application, the Automation permission typically attaches to the terminal emulator (Terminal.app, iTerm2, Ghostty, etc.) that launched OpenCode — not to OpenCode itself. Look for that process in the Automation list if the permission prompt doesn't appear.

## Environment variables

Pass environment variables via the `"environment"` map in the config:

```json
{
  "mcp": {
    "omnifocus": {
      "type": "local",
      "command": ["omnifocus-mcp"],
      "environment": {
        "OMNIFOCUS_LOG_LEVEL": "debug",
        "OMNIFOCUS_ALLOW_RAW_SCRIPT": "1"
      },
      "enabled": true
    }
  }
}
```

| Variable | Default | Purpose |
|---|---|---|
| `OMNIFOCUS_LOG_LEVEL` | `info` | Log verbosity: `trace` / `debug` / `info` / `warn` / `error` |
| `OMNIFOCUS_CACHE_TTL_MS` | `30000` | Read-cache TTL in milliseconds |
| `OMNIFOCUS_ALLOW_RAW_SCRIPT` | — | Set to `1` to enable `run_jxa_script` / `run_omnijs_script` escape hatches |

Full reference: [README — Environment variables](../../README.md#environment-variables).

## Troubleshooting

### No tools surfaced / "tool not found"

The server failed to start. Run it manually to check for startup errors:

```bash
omnifocus-mcp 2>&1 | head -20
```

A clean start logs `server started` on stderr. Restart OpenCode after fixing any errors.

### "OmniFocus is not running"

The server drives a running OmniFocus process via AppleScript. Open OmniFocus before or during the session.

### "Automation permission denied"

The permission is sticky once denied. Re-grant it at:

**System Settings → Privacy & Security → Automation → [your terminal] → OmniFocus** ✓

### Config changes not picked up

OpenCode reads the config at startup. After editing `opencode.json`, exit and re-launch OpenCode.

## Related

- [Generic stdio client setup](./generic-stdio.md) — the underlying stdio transport contract
- [README — Trust & security](../../README.md) — what data leaves the machine (none) and how the server is sandboxed
