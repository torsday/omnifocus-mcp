# OpenAI Codex CLI — omnifocus-mcp setup

Adds omnifocus-mcp as a local MCP server in [OpenAI Codex CLI](https://github.com/openai/codex).

## Prerequisites

- macOS 13 (Ventura) or later
- OmniFocus 3.15+ or OmniFocus 4.x
- Node.js 24 or newer (`node --version`)
- Codex CLI installed (`codex --version`)

## One-time install

```bash
npm install -g @torsday/omnifocus-mcp
```

Verify the binary is available:

```bash
omnifocus-mcp --version
```

## Configuration

Codex configures MCP servers via `~/.codex/config.toml`. Add an `[mcp_servers.<name>]` table:

```toml
[mcp_servers.omnifocus]
command = "omnifocus-mcp"
args = []
env = { OMNIFOCUS_LOG_LEVEL = "info" }
```

If the file or `[mcp_servers.*]` tables don't exist yet, create them. Don't remove other server entries.

## Verify

Restart Codex (it reads the config on startup), then ask:

> Use the `internal_status` tool and tell me what it returns.

Codex should call the tool and surface a JSON object with `uptimeMs`, `cacheStats`, and `circuitState`. If it can't find the tool, see [Troubleshooting](#troubleshooting).

## Grant macOS Automation permission

On the first call that touches OmniFocus, macOS prompts:

> "**Codex** wants access to control **OmniFocus**."

Click **OK**. If denied by mistake:

**System Settings → Privacy & Security → Automation → Codex → OmniFocus** ✓

The server itself runs under whatever process Codex spawned it from, so the permission needs to be granted to that process. If you launch Codex from a terminal, the permission may belong to your terminal app (Terminal.app, iTerm2, etc.) rather than to Codex itself.

## Per-client environment variables

Anything in `env` is set on the spawned server process. The most useful values:

| Variable | Default | Purpose |
|---|---|---|
| `OMNIFOCUS_LOG_LEVEL` | `info` | `debug` for verbose stderr (PII visible); `warn`/`error` to mute |
| `OMNIFOCUS_E2E` | (unset) | Set to `1` only for the E2E test suite — never in production |
| `OMNIFOCUS_ALLOW_RAW_SCRIPT` | (unset) | Set to `1` to expose `run_jxa_script` / `run_omnijs_script`. **Off by default for safety** (ADR-0004) |

Full reference: [`docs/design/configuration.md`](../design/configuration.md).

## Troubleshooting

### "tool not found" or no tools surfaced

The server failed to start. Run it manually to see startup logs:

```bash
omnifocus-mcp 2>&1 | head -20
```

A clean start logs `server started` on stderr. Anything else (config error, port-bind, stray-stdout guard) explains the failure.

### "OmniFocus is not running"

The server can't drive a closed app. Open OmniFocus once; subsequent calls will connect.

### "Automation permission denied"

See the Automation permission note above. The denied state is sticky — the server returns a typed `OF_PERMISSION_DENIED` error with a remediation hint until you toggle the permission on.

### Codex doesn't pick up changes to `config.toml`

Codex reads MCP config at process start. After editing, exit and re-run `codex` so the new server is registered.

## Related

- [Generic stdio client setup](./generic-stdio.md) — the underlying transport contract every MCP client uses
- [README — Trust & security](../../README.md) — what data leaves the machine (none) and how the server is sandboxed
