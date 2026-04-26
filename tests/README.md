# tests/

Cross-cutting test suites that don't belong next to a single source file.

## Layout

```
tests/
├── contract/    # Adapter contract harness — one suite, all implementations
└── integration/ # Real-OmniFocus integration tests (gated on env var)
```

Unit tests that target a single module continue to live next to their source
(e.g. `src/foo/Foo.test.ts`). The layout matches `vitest.config.ts`:

| Glob                       | Tier        | Runs on                                    |
|----------------------------|-------------|--------------------------------------------|
| `src/**/*.test.ts`         | unit        | `pnpm test` (always)                       |
| `tests/unit/**/*.test.ts`  | unit        | `pnpm test` (always)                       |
| `tests/integration/**`     | integration | `pnpm test:integration` (opt-in, live OF)  |

## Contract harness — `tests/contract/`

`adapter.contract.ts` exports `runAdapterContract(label, { createAdapter })`,
a single parameterized `describe` block every `OmniFocusAdapter` implementation
must pass. See DESIGN §19.

**Scope** — CRUD, filter semantics, and the typed error taxonomy. It's the
substitutability guarantee that lets services accept any adapter.

**Out of scope** — deliberately. These surfaces are exercised only in the
integration tier against real OmniFocus:

- `available` / `blocked` derivation
- recurring-task cascade on completion
- perspective evaluation (`evaluatePerspective`)
- sync mechanics (`syncTrigger`, `getLastSync`)
- attachments
- TaskPaper / OPML round-trips
- plug-in invocation (`pluginInvoke`)

### Drivers

- `tests/contract/inMemory.contract.test.ts` — runs the suite against
  `InMemoryAdapter` in the unit tier. This is the one that ships green on
  every `pnpm test`.
- (Planned) `tests/integration/adapter.jxa.contract.test.ts`,
  `…omnijs…`, `…router…` — run the same suite against the real transports
  under `OMNIFOCUS_INTEGRATION=1`. A live OmniFocus is required; the driver
  creates and tears down scratch fixtures via the `cleanup` hook.

### Writing a new driver

```ts
import { runAdapterContract } from "../contract/adapter.contract.js";
import { JxaTransport } from "../../src/adapter/jxa/JxaTransport.js";

runAdapterContract("JxaTransport", {
  createAdapter: () => new JxaTransport(/* … */),
  cleanup: async (adapter) => {
    // Delete scratch folders/projects/tags/tasks the suite created.
  },
});
```

## Running

```bash
pnpm test                   # unit tier (always)
pnpm test:integration       # integration tier (requires OMNIFOCUS_INTEGRATION=1)
pnpm test tests/contract    # contract harness only
```
