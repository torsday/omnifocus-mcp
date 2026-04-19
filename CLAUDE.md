# omnifocus-mcp

MCP server exposing the full OmniFocus surface to LLM agents via `@modelcontextprotocol/sdk`. TypeScript + Node.js. Talks to OmniFocus via **JXA** (primary) and **OmniJS** (fallback for features JXA can't reach).

## Always-on engineering context

Follow the standards in, in priority order:

1. `~/src/github.com/torsday/llm_prompts/coding.md` — SOLID, pure functions, typed errors, Goldilocks testing
2. `~/src/github.com/torsday/llm_prompts/systems_design.md` — options-first architecture, R/S/M eval, ADR discipline
3. `~/src/github.com/torsday/llm_prompts/agent_systems.md` — MCP tool design: atomic, composable, rich responses, actionable errors, idempotency, circuit breakers
4. `~/src/github.com/torsday/llm_prompts/traits.md` — interaction style

## Project-specific conventions

- **Adapter seam is sacred.** Services never see `osascript` or URL schemes. The `OmniFocusAdapter` interface is the only boundary between domain logic and the OS. Tests swap in `InMemoryAdapter`.
- **Scripts are first-class source files.** Every JXA/OmniJS script lives in `src/scripts/{jxa,omnijs}/*.js`, parameterized via `JSON.parse` of a single argument. No inline script strings in service code.
- **Tool naming:** `<noun>_<verb>` snake_case — `task_list`, `task_create`, `project_mark_reviewed`. Consistent verbs across nouns.
- **IDs only, never names.** OmniFocus names collide and change. All references use OF's persistent IDs at the API boundary.
- **Dates are ISO-8601 with offset** at the adapter boundary. OF's local-time strings stay inside the adapter.
- **Mutations invalidate the 30s LRU read cache.** Never bypass the cache layer directly.
- **Rich notes round-trip.** Task notes expose both `note` (plain) and `noteHtml` (fidelity). Prefer plain on read unless explicitly requested.
- **Attachments by path, never bytes.** Binary payloads don't belong in MCP text responses.

## Commands

```bash
pnpm install              # install deps
pnpm build                # tsup bundle → dist/
pnpm dev                  # tsx watch mode
pnpm test                 # vitest (unit only; mocked adapter)
pnpm test:integration     # requires OMNIFOCUS_INTEGRATION=1 and a live OF
pnpm lint                 # biome check
pnpm format               # biome format --write
pnpm typecheck            # tsc --noEmit
```

## Environment variables

- `OMNIFOCUS_INTEGRATION` — set to `1` to run integration tests against live OF
- `OMNIFOCUS_ALLOW_RAW_SCRIPT` — set to `1` to enable the `run_jxa_script` / `run_omnijs_script` escape-hatch tools (off by default)
- `OMNIFOCUS_LOG_LEVEL` — `trace` | `debug` | `info` | `warn` | `error` (default `info`); logs go to **stderr** — never stdout (stdout is MCP transport)
- `OMNIFOCUS_CACHE_TTL_MS` — override read-cache TTL (default 30000)

## Gotchas

- First `osascript` invocation triggers macOS Automation permission prompt. Surface a typed `PermissionDenied` error with instructions if it's denied.
- OmniFocus must be running for most operations. Adapter detects and raises `OmniFocusNotRunning` — don't auto-launch without a user-facing tool for it.
- Mutations don't propagate across devices until `sync_trigger` runs — document on every write tool.
- JXA is single-threaded relative to OF's main thread. Serialize mutations; never parallelize writes.
- Never log to stdout. MCP uses stdio transport and any stray stdout byte corrupts the protocol.

## Branch and PR conventions

- Work on whatever branch the user is on; never branch without being asked
- Never commit, stage, unstage, or push without explicit instruction
- Conventional Commits via `~/src/github.com/torsday/llm_prompts/commit.md` when asked
- PR review via `~/src/github.com/torsday/llm_prompts/review_pr.md`

## Workflow prompts

| Situation                       | Prompt                              |
| ------------------------------- | ----------------------------------- |
| New feature                     | `systems_design.md` → `tasking.md`  |
| Architectural decision          | `systems_design.md` → `adr.md`      |
| Pre-commit quality gate         | `refactor_changes.md`               |
| Tests                           | `unit_tests.md` / `integration_tests.md` |
| Debug a broken tool             | `debug.md`                          |
| Security review                 | `security_review.md`                |
| Autonomous session              | `next.md`                           |

## Reference docs

- `README.md` — project overview with architecture at a glance
- `SPEC.md` — functional scope and resolved decisions
- `DESIGN.md` — architecture and options evaluated (28 sections covering envelope, IDs, dates, pagination, concurrency, lifecycle, security, testing, CI, observability, config, distribution, versioning, deps, example tool, i18n, resources)
- `docs/domain-reference.md` — canonical OmniFocus schemas and glossary
- `docs/project-views.md` — recommended GitHub Project board views
- `TASKS.md` — sequenced backlog (M0–M5)
- `CONTRIBUTING.md` — patterns, conventions, PR template
- GitHub Issues — live backlog at [github.com/torsday/omnifocus-mcp/issues](https://github.com/torsday/omnifocus-mcp/issues)
- GitHub Project — live board at [github.com/users/torsday/projects/4](https://github.com/users/torsday/projects/4)
- `docs/adr/` — load-bearing decisions:
  - 0001 TypeScript + Node 20 runtime
  - 0002 JXA + OmniJS dual transport
  - 0003 `<noun>_<verb>` tool namespacing
  - 0004 opt-in raw-script tools
  - 0005 scripts as first-class files
  - 0006 30s LRU invalidate-on-write cache
  - 0007 ISO-8601 with offset on all dates
  - 0008 branded opaque ID types
  - 0009 read pool + write queue + OmniJS queue
  - 0010 stdio as sole MCP transport
  - 0011 semver + public contract definition
  - 0012 distribution via npx/npm
  - 0013 uniform tool response envelope
