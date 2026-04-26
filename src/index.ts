#!/usr/bin/env node
/**
 * omnifocus-mcp entry point — speaks Model Context Protocol over stdio.
 *
 * Default invocation (no args) boots the MCP server. The CLI also accepts
 * `--version` / `-v` and `--help` / `-h` so operators can identify the
 * installed binary and see usage without inspecting `package.json`.
 *
 * Anything written before the server connects must go to stderr — the
 * `--version` / `--help` paths exit before `startServer()` installs the
 * stdout guard, so it is safe to emit those to stdout where users expect
 * CLI output.
 */

import packageJson from "../package.json" with { type: "json" };
import { startServer } from "./server/mcpServer.js";

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`${packageJson.version}\n`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    `${packageJson.name} v${packageJson.version}\n` +
      `${packageJson.description}\n` +
      `\n` +
      `Usage: omnifocus-mcp\n` +
      `\n` +
      `Speaks Model Context Protocol over stdio. Add to your MCP client's\n` +
      `configuration (Claude Desktop, Claude Code, etc.) — see the README\n` +
      `for client-specific setup: ${packageJson.homepage}\n` +
      `\n` +
      `Options:\n` +
      `  -v, --version    Print version and exit\n` +
      `  -h, --help       Show this help and exit\n` +
      `\n` +
      `Environment:\n` +
      `  OMNIFOCUS_LOG_LEVEL          pino log level (default: info)\n` +
      `  OMNIFOCUS_ALLOW_RAW_SCRIPT   Enable raw-script tools (off by default)\n` +
      `  OMNIFOCUS_JXA_TIMEOUT_MS     Per-call JXA timeout (default: 30000)\n` +
      `  OMNIFOCUS_OMNIJS_TIMEOUT_MS  Per-call OmniJS timeout (default: 45000)\n`,
  );
  process.exit(0);
}

startServer().catch((err) => {
  // Last-resort: write to stderr so the error is visible without corrupting
  // the stdio MCP transport.
  process.stderr.write(`[omnifocus-mcp] Fatal startup error: ${String(err)}\n`);
  process.exit(1);
});
