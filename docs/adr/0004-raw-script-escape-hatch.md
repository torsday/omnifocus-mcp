# ADR-0004: Opt-in raw-script escape-hatch tools

**Date:** 2026-04-19
**Status:** Accepted

---

## Context

Full OmniFocus coverage is a moving target: Omni ships new features, OmniJS gains capabilities, users have bespoke plug-ins. Any wrapped tool surface will inevitably lag the OF feature set. The question is how we handle that gap:

- **Ignore it** — only what's wrapped is reachable. Power users are blocked until we ship an update.
- **Escape hatch always on** — an `run_jxa_script` / `run_omnijs_script` tool always exposed. Unsafe default.
- **Escape hatch behind a flag** — off by default; opt in per install.

This is the "safe by default, powerful on demand" tradeoff. For a single-user local MCP the blast radius is the user's own OF data, which the user controls — but the agent is not the user, and an always-on arbitrary-script tool is a capability the agent does not need by default.

## Decision

We will ship **`run_jxa_script` and `run_omnijs_script` as opt-in tools**, disabled unless the environment variable `OMNIFOCUS_ALLOW_RAW_SCRIPT=1` is set.

- When disabled, the tools are not registered with the MCP server — the agent does not even see them.
- When enabled, each tool's description loudly states "Accepts arbitrary script code; use only for operations not covered by specific tools. Prefer named tools when they exist."
- Every call is logged at `info` level with the script source (regardless of log level) so audit is possible.

## Options Considered

| Option | Pros | Cons |
| ------ | ---- | ---- |
| No escape hatch | Strict tool contract; no arbitrary execution | Blocks power users until we ship a wrapper; any OF feature we miss is unreachable |
| **Opt-in escape hatch** | Safe default; forward-compat with anything Omni ships; user explicitly accepts the capability | Agent can do anything OF can do when enabled; onus is on the user to enable only when needed |
| Always-on escape hatch | No config step | Unsafe default; violates least-privilege; an agent that misbehaves has broad reach |
| Escape hatch with per-call confirmation prompt | Extra safety layer | Breaks non-interactive agent sessions; confirmation UX doesn't exist in MCP |

## Consequences

**Positive**

- Default install is safe: agent can only invoke wrapped tools with typed, reviewed behavior
- When enabled, the user has a pressure valve — any OF capability reachable via JXA or OmniJS is reachable, even before we've wrapped it
- The raw tools double as a development aid: while prototyping a new wrapped tool, we can validate the underlying script via the raw tool first

**Negative**

- Two modes to test (enabled / disabled) — more test combinations
- Power users must document enabling the flag in their setup, adding a small friction step
- Escape hatches can become crutches; teams may stop shipping wrappers because "users can just use `run_omnijs_script`"

**Risks**

- **Agent misuse when enabled** — mitigated by loud tool description, audit logging, and (if needed later) adding an allowlist of script patterns the tool will accept
- **Accidental enablement** — the env var is explicit and not commonly set; documented prominently in `CLAUDE.md`
- **Regression gap** — if a wrapped tool breaks, agents may silently fall back to raw scripts and hide the regression. Mitigated by per-tool metrics: if raw-script usage rises without a new use case, investigate.

## References

- `DESIGN.md` §5 — options for the escape hatch
- `SPEC.md` — raw-script tools listed as opt-in functional requirements
- `~/src/github.com/torsday/llm_prompts/agent_systems.md` — capability grants, per-tool policy
