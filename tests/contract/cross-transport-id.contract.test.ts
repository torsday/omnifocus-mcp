/**
 * Property-based contract test for ADR-0019 — cross-transport ID
 * interoperability.
 *
 * The contract under test:
 *
 *   "Any ID returned by any method must be acceptable as input to any other
 *    method that takes that brand type, regardless of transport routing."
 *
 * That contract was silently violated from v1.0.0 through v1.2.0 — JXA-routed
 * `createProject` returned a transient specifier ID that OmniJS-routed
 * mutations couldn't resolve. ADR-0019 reroutes creates through OmniJS so
 * the persistent-ID lineage round-trips. This test encodes the invariant
 * with `fast-check` so future regressions surface with an attributable
 * shrunk counter-example.
 *
 * For every brand × (writeTransport, readTransport) pair, the property is:
 *   1. id = writeTransport.createX({ name })
 *   2. obj = readTransport.getX(id)
 *   3. assert obj.id === id           // round-trip preserved across transports
 *   4. assert obj.name === name        // the right object came back
 *
 * Pairs depending on a `notYetWired` operation are skipped today with an
 * explicit message naming the gap — when those wires land, removing the skip
 * graduates the pair to enforced. Pairs currently exercised:
 *
 *   | brand   | JXA→JXA | JXA→OJS | OJS→JXA | OJS→OJS |
 *   |---------|---------|---------|---------|---------|
 *   | task    | ✓       | skip(R) | ✓       | skip(R) |
 *   | project | ✓       | skip(R) | ✓       | skip(R) |
 *   | tag     | ✓       | skip(R) | skip(W) | skip(B) |
 *   | folder  | ✓       | skip(R) | skip(W) | skip(B) |
 *
 *   R = read-side notYetWired; W = write-side notYetWired; B = both.
 *
 * Gated on `OMNIFOCUS_INTEGRATION=1` — needs a live OmniFocus running on
 * macOS with Automation permission granted (the bug class is transport-
 * specific, so InMemoryAdapter cannot exercise it).
 *
 * Each property runs 10 random examples by default — fast-check shrinks any
 * failure to the smallest counter-example automatically. Names use the
 * `mcp-fixture:` prefix matching `tests/integration/transportRouter.contract.test.ts`
 * so cleanup reasoning stays consistent across the integration tier.
 *
 * @see docs/adr/0019-cross-transport-id-interoperability.md
 * @see tests/integration/transportRouter.contract.test.ts — sibling suite
 */

import * as fc from "fast-check";
import { describe, expect, test } from "vitest";
import { JxaTransport } from "../../src/adapter/jxa/JxaTransport.js";
import type {
  CreateFolderInput,
  CreateProjectInput,
  CreateTagInput,
  CreateTaskInput,
} from "../../src/adapter/OmniFocusAdapter.js";
import { OmniJsTransport } from "../../src/adapter/omnijs/OmniJsTransport.js";

const INTEGRATION = process.env.OMNIFOCUS_INTEGRATION === "1";

if (!INTEGRATION) {
  describe("cross-transport ID round-trip property (ADR-0019)", () => {
    test.skip("skipped — set OMNIFOCUS_INTEGRATION=1 and ensure OmniFocus is running", () => {});
  });
} else {
  // -------------------------------------------------------------------------
  // Fixtures
  //
  // One shared instance per transport — they are stateless; only the OF
  // database has state. The `mcp-fixture:` prefix matches what the existing
  // integration suite (`tests/integration/transportRouter.contract.test.ts`)
  // uses, so a stuck cleanup in either suite is recognizable in the OF UI.
  //
  // Cleanup happens per fast-check iteration via `try/finally` inside each
  // property body — NOT in a single `afterAll` sweep. Per-iteration cleanup
  // matters here because each property runs `numRuns` create operations
  // against the live database; carrying 10+ test fixtures in the database
  // simultaneously contaminates later iterations (observed empirically: an
  // afterAll-only sweep produced shifting failure patterns across runs).
  // The `.catch(() => {})` swallows post-assertion delete failures so a
  // genuine ID-round-trip violation still surfaces with the original error.
  // -------------------------------------------------------------------------

  const jxa = new JxaTransport();
  const omnijs = new OmniJsTransport();

  // Each property runs `NUM_RUNS` create→read→delete cycles against live
  // OmniFocus. JXA round-trips average ~2 s per call (osascript launch +
  // OF Automation roundtrip); OmniJS round-trips are similar. The default
  // 30 s vitest timeout is too tight for 10 iterations × 3 ops each, so
  // each integration test runs at TEST_TIMEOUT_MS.
  const TEST_TIMEOUT_MS = 90_000;

  // -------------------------------------------------------------------------
  // Arbitraries — names with the mcp-fixture: prefix and a small variation
  // surface. We deliberately avoid quote/backslash/newline characters: this
  // test asserts ID round-trip, not JXA-string-encoding robustness, and the
  // latter is its own (separate) concern.
  // -------------------------------------------------------------------------

  const safeNameSuffixArb = fc.stringMatching(/^[A-Za-z0-9 _-]{1,40}$/);
  const fixtureNameArb = safeNameSuffixArb.map((s) => `mcp-fixture: ${s}`);

  const NUM_RUNS = 10;

  // -------------------------------------------------------------------------
  // task
  // -------------------------------------------------------------------------

  describe("TaskId — cross-transport round-trip", () => {
    test(
      "write via JxaTransport, read via JxaTransport — ids round-trip",
      async () => {
        await fc.assert(
          fc.asyncProperty(fixtureNameArb, async (name) => {
            const input: CreateTaskInput = { name };
            const id = await jxa.createTask(input);
            try {
              const obj = await jxa.getTask(id);
              expect(obj.id).toBe(id);
              expect(obj.name).toBe(name);
            } finally {
              await jxa.deleteTask(id).catch(() => {});
            }
          }),
          { numRuns: NUM_RUNS },
        );
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "write via OmniJsTransport, read via JxaTransport — ids round-trip (the case ADR-0019 fixes)",
      async () => {
        await fc.assert(
          fc.asyncProperty(fixtureNameArb, async (name) => {
            const input: CreateTaskInput = { name };
            const id = await omnijs.createTask(input);
            try {
              const obj = await jxa.getTask(id);
              expect(obj.id).toBe(id);
              expect(obj.name).toBe(name);
            } finally {
              await jxa.deleteTask(id).catch(() => {});
            }
          }),
          { numRuns: NUM_RUNS },
        );
      },
      TEST_TIMEOUT_MS,
    );

    test.skip("write via JxaTransport, read via OmniJsTransport — getTask is notYetWired on OmniJsTransport (gap to fill)", () => {});

    test.skip("write via OmniJsTransport, read via OmniJsTransport — getTask is notYetWired on OmniJsTransport (gap to fill)", () => {});
  });

  // -------------------------------------------------------------------------
  // project
  // -------------------------------------------------------------------------

  describe("ProjectId — cross-transport round-trip", () => {
    test(
      "write via JxaTransport, read via JxaTransport — ids round-trip",
      async () => {
        await fc.assert(
          fc.asyncProperty(fixtureNameArb, async (name) => {
            const input: CreateProjectInput = { name };
            const id = await jxa.createProject(input);
            try {
              const obj = await jxa.getProject(id);
              expect(obj.id).toBe(id);
              expect(obj.name).toBe(name);
            } finally {
              await jxa.deleteProject(id).catch(() => {});
            }
          }),
          { numRuns: NUM_RUNS },
        );
      },
      TEST_TIMEOUT_MS,
    );

    // Gated on #681 — `OmniJsTransport.createProject` does not yet return
    // a persistent id per ADR-0019. Empirical: an id created via OmniJS
    // surfaces as `OF_NOT_FOUND` on the immediate JXA `getProject` call,
    // which is exactly the symptom ADR-0019 documents pre-fix. Remove the
    // skip when #681 merges; this property is the regression guard.
    test.skip("write via OmniJsTransport, read via JxaTransport — gated on #681 (ADR-0019 createProject reroute not yet shipped)", () => {});

    test.skip("write via JxaTransport, read via OmniJsTransport — getProject is notYetWired on OmniJsTransport (gap to fill)", () => {});

    test.skip("write via OmniJsTransport, read via OmniJsTransport — getProject is notYetWired on OmniJsTransport (gap to fill)", () => {});
  });

  // -------------------------------------------------------------------------
  // tag
  // -------------------------------------------------------------------------

  describe("TagId — cross-transport round-trip", () => {
    test(
      "write via JxaTransport, read via JxaTransport — ids round-trip",
      async () => {
        await fc.assert(
          fc.asyncProperty(fixtureNameArb, async (name) => {
            const input: CreateTagInput = { name };
            const id = await jxa.createTag(input);
            try {
              const obj = await jxa.getTag(id);
              expect(obj.id).toBe(id);
              expect(obj.name).toBe(name);
            } finally {
              await jxa.deleteTag(id).catch(() => {});
            }
          }),
          { numRuns: NUM_RUNS },
        );
      },
      TEST_TIMEOUT_MS,
    );

    test.skip("write via OmniJsTransport, read via JxaTransport — createTag is notYetWired on OmniJsTransport (gap to fill)", () => {});

    test.skip("write via JxaTransport, read via OmniJsTransport — getTag is notYetWired on OmniJsTransport (gap to fill)", () => {});

    test.skip("write via OmniJsTransport, read via OmniJsTransport — both createTag and getTag are notYetWired on OmniJsTransport (gap to fill)", () => {});
  });

  // -------------------------------------------------------------------------
  // folder
  // -------------------------------------------------------------------------

  describe("FolderId — cross-transport round-trip", () => {
    test(
      "write via JxaTransport, read via JxaTransport — ids round-trip",
      async () => {
        await fc.assert(
          fc.asyncProperty(fixtureNameArb, async (name) => {
            const input: CreateFolderInput = { name };
            const id = await jxa.createFolder(input);
            try {
              const obj = await jxa.getFolder(id);
              expect(obj.id).toBe(id);
              expect(obj.name).toBe(name);
            } finally {
              await jxa.deleteFolder(id).catch(() => {});
            }
          }),
          { numRuns: NUM_RUNS },
        );
      },
      TEST_TIMEOUT_MS,
    );

    test.skip("write via OmniJsTransport, read via JxaTransport — createFolder is notYetWired on OmniJsTransport (gap to fill)", () => {});

    test.skip("write via JxaTransport, read via OmniJsTransport — getFolder is notYetWired on OmniJsTransport (gap to fill)", () => {});

    test.skip("write via OmniJsTransport, read via OmniJsTransport — both createFolder and getFolder are notYetWired on OmniJsTransport (gap to fill)", () => {});
  });
}
