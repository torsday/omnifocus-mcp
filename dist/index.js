#!/usr/bin/env node
// omnifocus-mcp v0.0.1 — placeholder binary.
//
// This release claims the npm name. The real implementation is in progress;
// track it at https://github.com/torsday/omnifocus-mcp (see SPEC.md, DESIGN.md,
// the 13 ADRs under docs/adr/, and the 94 issues on the backlog).
//
// This file will be replaced with the real MCP server bundle (produced by
// tsup from src/) in a later release. Do not depend on its behavior.

const message = {
  event: "placeholder.invoked",
  level: "info",
  package: "@torsday/omnifocus-mcp",
  version: "0.0.1",
  message:
    "@torsday/omnifocus-mcp v0.0.1 is a placeholder release. " +
    "The MCP server implementation is in progress. " +
    "See https://github.com/torsday/omnifocus-mcp for the design, backlog, and schedule.",
  docs: "https://github.com/torsday/omnifocus-mcp",
  issues: "https://github.com/torsday/omnifocus-mcp/issues",
  project: "https://github.com/users/torsday/projects/4",
};

// Write to stderr (MCP uses stdout; we never write there).
process.stderr.write(JSON.stringify(message) + "\n");
process.exit(0);
