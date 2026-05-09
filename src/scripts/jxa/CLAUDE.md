# `src/scripts/jxa/` — agent orientation

JXA scripts that run inside `osascript` against the OmniFocus 4.x scripting interface. Read this before editing any file in this directory — three of the invariants below are how #673 shipped undetected for three release tags.

## Runtime distinction

These files run **inside `osascript`**, not Node. No npm modules, no `import`, no `Buffer`. Whatever isn't on the OmniFocus JXA DOM (or built into JavaScriptCore on macOS) doesn't exist here. The build inlines them as strings before they ship — see ADR-0020 (`docs/adr/0020-build-time-script-inlining.md`).

Each script reads its arguments by `JSON.parse`-ing the single argv value the spawner passes (per ADR-0005). No environment variables, no stdin, no file I/O.

## OmniFocus 4.x quirks

- **`tag.parent()` throws.** Use `tag.container()` and check `container.id() === doc.id()` to distinguish a top-level tag from a nested tag. `parent()` itself raises `Can't convert types` in OF 4.x — the older `parent.class()` workaround is dead. See `build_tag.js` and the fix that #768 / commit `ba4abc5` shipped.
- **`containingProject().class()` is an object call, not a string read.** It throws on real project specifiers in OF 4.x. Guard the call; on the throw path, *do not* clear `projectId` — the throw means "yes, it's a project," not "no project." The fix in commit `b40a4a0` is the reference.
- **`flattenedTasks.byId()` returns a specifier with error code `-1728`** when the ID does not exist (rather than `null`). Catch this at the transport boundary and map to `NotFoundError`; never let `-1728` leak to callers. Reference: `ec53b88` and #674.
- **`flattenedTasks()` is full-DB.** When you have a narrowing source (a tag, a project), iterate that source's tasks instead — see `task_list.js`'s `tagId` shortcut. A naive whole-DB scan blows the 30s scriptRunner timeout on real databases.

## Testing

Two harnesses, very different:

1. **`src/adapter/jxa/JxaTransport.test.ts` — bridge-mock pattern.** Pass a `spawner` that returns canned stdout. Tests assert which script was invoked with which args. Use this for handler / shape coverage; no JXA actually runs.
2. **`src/adapter/jxa/sandbox/` — sandboxed JS-eval harness.** Loads scripts and runs them against a JavaScriptCore-compatible mock of the OmniFocus DOM. Use this when you want to exercise the script's own logic (filter conditions, error mapping) without spawning `osascript`. Reference: commit `72d659d` and #723.

The live integration suite (`*.integration.test.ts`, gated by `OMNIFOCUS_INTEGRATION=1`) only runs on `mac-local`. Don't add tests there for logic that the sandbox can cover.

## When you change a script

- The build step (`pnpm build` → tsup → inlining) compiles JXA strings into `dist/`. After editing a script, run `pnpm test` then `pnpm build` to confirm the inlining still parses.
- If the change crosses the JXA → OmniJS boundary (per ADR-0019), check that ID interoperability survives — IDs returned by JXA must be passable to OmniJS scripts and vice versa.
- Don't introduce ES2022+ syntax that JavaScriptCore on the supported macOS version doesn't accept. The runtime is older than Node — when in doubt, prefer `function` over `class`, `var` over `const` if scoping doesn't matter, and explicit `for` loops over modern array methods.

## Related

- `docs/design/jxa.md` — the deeper "how the system thinks" view (post-#805)
- `src/adapter/jxa/JxaTransport.ts` — transport entry point that spawns these scripts
- ADR-0002 (dual transport), ADR-0005 (scripts as first-class files), ADR-0019 (cross-transport ID interoperability), ADR-0020 (build-time inlining)
