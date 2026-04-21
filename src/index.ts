#!/usr/bin/env node
// omnifocus-mcp entry point — boots the MCP server over stdio.
// Tool registrations arrive in M1+; see src/server/mcpServer.ts for bootstrap.

import { startServer } from "./server/mcpServer.js";

startServer().catch((err) => {
  // Last-resort: write to stderr so the error is visible without corrupting
  // the stdio MCP transport.
  process.stderr.write(`[omnifocus-mcp] Fatal startup error: ${String(err)}\n`);
  process.exit(1);
});
