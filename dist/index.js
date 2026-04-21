#!/usr/bin/env node
// src/index.ts
var notice = {
  event: "placeholder.invoked",
  level: "info",
  package: "@torsday/omnifocus-mcp",
  version: "0.0.1",
  message: "@torsday/omnifocus-mcp is a placeholder release. The MCP server implementation is in progress. See https://github.com/torsday/omnifocus-mcp for the design, backlog, and schedule.",
  docs: "https://github.com/torsday/omnifocus-mcp",
  issues: "https://github.com/torsday/omnifocus-mcp/issues",
  project: "https://github.com/users/torsday/projects/4"
};
process.stderr.write(`${JSON.stringify(notice)}
`);
process.exit(0);
