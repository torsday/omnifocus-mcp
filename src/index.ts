#!/usr/bin/env node
// omnifocus-mcp entry point.
//
// M0 scaffolding: this file exists so tsup has an entry and `pnpm build`
// produces the same kind of placeholder bundle the hand-written dist/index.js
// served before. The real MCP server bootstrap lands in issue #27.

type PlaceholderNotice = {
  event: "placeholder.invoked";
  level: "info";
  package: "@torsday/omnifocus-mcp";
  version: string;
  message: string;
  docs: string;
  issues: string;
  project: string;
};

const notice: PlaceholderNotice = {
  event: "placeholder.invoked",
  level: "info",
  package: "@torsday/omnifocus-mcp",
  version: "0.0.1",
  message:
    "@torsday/omnifocus-mcp is a placeholder release. " +
    "The MCP server implementation is in progress. " +
    "See https://github.com/torsday/omnifocus-mcp for the design, backlog, and schedule.",
  docs: "https://github.com/torsday/omnifocus-mcp",
  issues: "https://github.com/torsday/omnifocus-mcp/issues",
  project: "https://github.com/users/torsday/projects/4",
};

// MCP uses stdout as the protocol transport. Every diagnostic must go to stderr.
process.stderr.write(`${JSON.stringify(notice)}\n`);
process.exit(0);
