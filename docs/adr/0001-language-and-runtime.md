# ADR-0001: TypeScript on Node.js 20 LTS as the implementation stack

**Date:** 2026-04-19
**Status:** Accepted

---

## Context

`omnifocus-mcp` is an MCP server exposing OmniFocus's scripting surface to LLM agents on macOS. We must choose a language and runtime for the server process itself. Three shapes of constraint apply:

- **Transport to OmniFocus** happens via `osascript` (JXA) or the `omnifocus://` URL scheme. Either way, we shell out to macOS-level integration points. Language choice does not change what OmniFocus can do for us.
- **MCP SDK maturity** varies by language: TypeScript and Python are the most mature; Swift, Go, Rust trail.
- **Distribution** should be simple for a single-user local tool — ideally `npx`-runnable or a Claude Desktop extension.

With no decision, the choice would be made implicitly at first commit, and switching later is expensive (rewriting tool handlers, service layer, and test infrastructure).

## Decision

We will build on **TypeScript 5.x targeting Node.js 20 LTS**, using `@modelcontextprotocol/sdk` for MCP transport.

## Options Considered

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **TypeScript + Node.js** | Most mature MCP SDK; same language as JXA scripts (reduces context-switch); broad ecosystem; `npx` distribution; `zod` for schemas | Node startup ~100ms; `execFile` per osascript call adds overhead (measured irrelevant vs OF latency) |
| Python + MCP SDK | Strong MCP SDK; popular in agent tooling | Still shells to `osascript` (no advantage); forces language switch between server and OF scripts; less type safety without explicit Pydantic everywhere |
| Swift + ScriptingBridge | Native in-process calls to OF; no osascript shell-out | MCP Swift SDK is early and thin; harder to distribute (build per arch or universal binary); more complexity for minimal measurable gain |
| Go + MCP SDK | Single static binary distribution | No Go path to ScriptingBridge without CGo gymnastics; still shells to osascript; MCP Go SDK less mature |

## Consequences

**Positive**

- Mature MCP SDK means less time spent on transport plumbing and more on domain coverage
- Same language (JavaScript) powers JXA scripts, the MCP server, and test code — fewer mental context switches
- `zod` provides single-source-of-truth schemas for tool inputs, auto-converted to JSON Schema for MCP
- `npx omnifocus-mcp` is a one-line install for end users
- Pool of future contributors is largest in this stack

**Negative**

- Node startup adds ~100ms to server cold-start (amortized across session lifetime; irrelevant after first call)
- `execFile` per osascript call has IPC overhead; mitigated by the 30s LRU read cache
- `any` creep is a continuous pressure; mitigated by `@typescript-eslint/no-explicit-any` and code review

**Risks**

- If per-call IPC latency becomes a measured bottleneck in real agent use (unlikely — OF response time dominates), revisit Swift. The adapter seam keeps this a transport-level change, not an architectural rewrite.
- TypeScript MCP SDK API changes would ripple through tool/resource handlers; mitigated by keeping handlers thin (pure delegation to services).

## References

- `DESIGN.md` §2 — options for language + runtime
- `SPEC.md` — functional scope that informs "what the server must do well"
- `~/src/github.com/torsday/llm_prompts/coding.md` — TypeScript standards applied here
