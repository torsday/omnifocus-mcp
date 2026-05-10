<!-- Originally DESIGN.md §§23–25 (split per #805) -->

# Distribution, versioning, and dependencies

## Distribution & install

### Package

- Published to npm as `@torsday/omnifocus-mcp`
- Single-file bundle: `dist/index.js` (tsup-produced)
- Shebang at top: `#!/usr/bin/env node`
- `bin` field in package.json: `omnifocus-mcp`

### Install patterns

```bash
# Zero-install, per-session
npx @torsday/omnifocus-mcp

# Global install
npm install -g @torsday/omnifocus-mcp
omnifocus-mcp

# Claude Desktop config snippet
{
  "mcpServers": {
    "omnifocus": {
      "command": "npx",
      "args": ["-y", "@torsday/omnifocus-mcp"],
      "env": { "OMNIFOCUS_LOG_LEVEL": "info" }
    }
  }
}

# Claude Code — project-scoped
claude mcp add omnifocus -- npx -y @torsday/omnifocus-mcp
```

### Deferred distribution channels

- **Homebrew tap** — nice-to-have; deferred until a user asks
- **Claude Desktop Extension (`.dxt`)** — once the DXT format stabilizes; adds one-click install + automatic config injection
- **Prebuilt binaries** (`pkg`-bundled) — not needed; `npx` is the platform-native path

Recorded as **ADR-0012**.

---

## Versioning & stability contract

Semver with an explicit definition of what counts as a breaking change.

### Public contract (stable surface)

- **Tool names** — renaming is major
- **Tool input schema required fields** — adding a required field is major; adding an optional field is minor
- **Tool response envelope shape** ([envelope.md](./envelope.md)) — changing field names, types, or removing fields is major
- **Error `code`s** — removing or renaming is major; adding is minor
- **Resource URIs** (e.g. `omnifocus://inbox`) — renaming is major
- **CLI invocation** (`omnifocus-mcp [args]`) — removing args is major

### Non-contract (changeable without bump)

- Log event names and extra fields (logs are for operators, not automation)
- Internal script contents
- Bundle size, startup time, performance characteristics (improvements don't bump)
- Adapter interface signatures (internal)

### Deprecation cycle

- Deprecated tool: logs `warn` once per session when invoked, description prefixed `[DEPRECATED]`
- Minimum one minor version deprecation period before removal
- Breaking changes documented in `CHANGELOG.md` under the `## Breaking` section

Recorded as **ADR-0011**.

---

## Dependency inventory

### Runtime dependencies

| Package                              | Purpose                                     | Why this one                              |
| ------------------------------------ | ------------------------------------------- | ----------------------------------------- |
| `@modelcontextprotocol/sdk`          | MCP server + stdio transport                | Official, most mature                     |
| `zod`                                | Tool input / schema validation              | Industry-standard; great TS inference     |
| `zod-to-json-schema`                 | Convert zod → MCP JSON Schema               | Standard pairing with zod + MCP SDK       |
| `pino`                               | Structured JSON logging                     | Fast; stderr-friendly; small footprint    |
| `ulid`                               | Correlation IDs                             | Sortable, collision-resistant             |
| `lru-cache`                          | Read cache backend                          | Mature; supports TTL; small               |

### Dev dependencies

| Package                              | Purpose                                     |
| ------------------------------------ | ------------------------------------------- |
| `typescript`                         | Compiler                                    |
| `tsup`                               | Bundler; single-file dist output            |
| `tsx`                                | Dev runtime (`pnpm dev`)                    |
| `vitest`                             | Test runner                                 |
| `@vitest/coverage-v8`                | Coverage (optional; not a hard target)      |
| `fast-check`                         | Property-based tests                        |
| `biome`                              | Lint + format                               |
| `@types/node`                        | Node type declarations                      |

### Policy

- Pinned exact versions in `pnpm-lock.yaml`, committed
- `pnpm audit` runs in CI; high-severity findings block release
- No dependency that does something trivial we could write inline (per `coding.md`)
- Every new dependency requires a one-line justification in the PR description
