# Generic stdio client — omnifocus-mcp setup

Connects any MCP-compatible client that speaks the stdio transport to omnifocus-mcp.

## Prerequisites

- macOS 13 (Ventura) or later
- OmniFocus 3.15+ or OmniFocus 4.x
- Node.js 20 LTS or 22 LTS (`node --version`)

## Install

```bash
npm install -g @torsday/omnifocus-mcp
```

Verify:

```bash
omnifocus-mcp --version
```

## How stdio transport works

`omnifocus-mcp` speaks the [Model Context Protocol](https://modelcontextprotocol.io) over **stdio**:

- **stdin** — receives JSON-RPC requests from the client
- **stdout** — emits JSON-RPC responses back to the client
- **stderr** — server logs only; never written to stdout

The client spawns the process and pipes its stdio. No network port is opened.

> ⚠️ Never attach anything to stdout of this process other than the MCP client. Any stray byte on stdout corrupts the protocol framing and causes `OF_STRAY_STDOUT` errors.

## Connection string / spawn config

Most MCP clients accept a command + args pair. Use:

| Field | Value |
|---|---|
| command | `omnifocus-mcp` |
| args | `[]` (none required) |
| transport | `stdio` |

### JSON form (used by most clients)

```json
{
  "command": "omnifocus-mcp",
  "args": [],
  "env": {
    "OMNIFOCUS_LOG_LEVEL": "info"
  }
}
```

### Shell invocation (for testing / scripting)

```bash
omnifocus-mcp
```

Pipe requests on stdin, read responses on stdout. The server runs until stdin closes or it receives SIGTERM/SIGINT.

## Sending a request by hand

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}' | omnifocus-mcp
```

The server responds with its capabilities, then waits for more requests.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OMNIFOCUS_LOG_LEVEL` | `info` | Log verbosity: `trace` / `debug` / `info` / `warn` / `error` (written to stderr) |
| `OMNIFOCUS_CACHE_TTL_MS` | `30000` | Read-cache TTL in milliseconds |
| `OMNIFOCUS_READ_GRACE_MS` | `5000` | Grace window for in-flight reads on SIGTERM/SIGINT |
| `OMNIFOCUS_WRITE_GRACE_MS` | `10000` | Grace window for in-flight writes on SIGTERM/SIGINT |
| `OMNIFOCUS_ALLOW_RAW_SCRIPT` | — | Set to `1` to enable `run_jxa_script` / `run_omnijs_script` escape hatches |

## macOS Automation permission

The first `osascript` call triggers a macOS Automation permission prompt from the terminal or client app that spawned the process:

> **"[App]" would like to control "OmniFocus"**

Click **OK**. If denied, re-grant in:

**System Settings → Privacy & Security → Automation → [App] → OmniFocus** ✓

The error when permission is missing is `OF_PERMISSION_DENIED` with `remediationClass: "environment"`.

## Graceful shutdown

Send **SIGTERM** or **SIGINT** to the process. It will:

1. Stop accepting new tool calls (`OF_SHUTTING_DOWN` for any new requests)
2. Drain in-flight reads (up to `OMNIFOCUS_READ_GRACE_MS`)
3. Drain in-flight writes (up to `OMNIFOCUS_WRITE_GRACE_MS`)
4. Flush logs and exit 0

## Verifying connectivity

After connection, call `tools/list` — you should see 60+ tools. Then call `internal_status`:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "internal_status",
    "arguments": {}
  }
}
```

A healthy response includes `"status": "ok"` and the OmniFocus version in `data.ofVersion`.
