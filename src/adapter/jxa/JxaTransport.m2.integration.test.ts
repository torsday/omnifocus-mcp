/**
 * Integration tests for `JxaTransport` — M2 perspective domain methods.
 *
 * These tests require a running OmniFocus instance and are gated behind the
 * `OMNIFOCUS_INTEGRATION=1` environment variable. They exercise real JXA
 * calls via `osascript` rather than a mocked spawner.
 *
 * Run with:
 *   OMNIFOCUS_INTEGRATION=1 pnpm test:integration
 *
 * @see src/adapter/jxa/JxaTransport.m2.test.ts — unit tests (no OF required)
 */

import { describe, expect, it } from "vitest";
import type { BuiltinPerspectiveId } from "../../domain/perspective.js";
import { BUILTIN_PERSPECTIVE_IDS } from "../../domain/perspective.js";
import { ScriptError } from "../../errors/index.js";
import { JxaTransport } from "./JxaTransport.js";

const INTEGRATION = process.env.OMNIFOCUS_INTEGRATION === "1";

describe.skipIf(!INTEGRATION)("JxaTransport — perspective integration", () => {
  const t = new JxaTransport();

  // -------------------------------------------------------------------------
  // listPerspectives
  // -------------------------------------------------------------------------

  describe("listPerspectives", () => {
    it("returns at least the 7 builtin perspectives", async () => {
      const perspectives = await t.listPerspectives();
      expect(perspectives.length).toBeGreaterThanOrEqual(BUILTIN_PERSPECTIVE_IDS.length);
    });

    it("all builtin IDs are present", async () => {
      const perspectives = await t.listPerspectives();
      const ids = perspectives.map((p) => p.id);
      for (const builtinId of BUILTIN_PERSPECTIVE_IDS) {
        expect(ids).toContain(builtinId);
      }
    });

    it("each perspective has required shape fields", async () => {
      const perspectives = await t.listPerspectives();
      for (const p of perspectives) {
        expect(typeof p.id).toBe("string");
        expect(p.id.length).toBeGreaterThan(0);
        expect(typeof p.name).toBe("string");
        expect(p.name.length).toBeGreaterThan(0);
        expect(["builtin", "custom"]).toContain(p.kind);
        expect(typeof p.requiresPro).toBe("boolean");
        // icon is string | null
        expect(p.icon === null || typeof p.icon === "string").toBe(true);
      }
    });

    it("builtin perspectives have requiresPro=false", async () => {
      const perspectives = await t.listPerspectives();
      const builtins = perspectives.filter((p) => p.kind === "builtin");
      for (const p of builtins) {
        expect(p.requiresPro).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // evaluatePerspective (builtin)
  // -------------------------------------------------------------------------

  describe("evaluatePerspective", () => {
    it("returns an array (possibly empty) for the Inbox perspective", async () => {
      const tasks = await t.evaluatePerspective("inbox" as BuiltinPerspectiveId);
      expect(Array.isArray(tasks)).toBe(true);
    });

    it("returned tasks have required shape fields", async () => {
      const tasks = await t.evaluatePerspective("inbox" as BuiltinPerspectiveId);
      for (const task of tasks) {
        expect(typeof task.id).toBe("string");
        expect(task.id.length).toBeGreaterThan(0);
        expect(typeof task.name).toBe("string");
        expect(typeof task.completed).toBe("boolean");
        expect(typeof task.flagged).toBe("boolean");
      }
    });

    it("returns an array for the Flagged perspective", async () => {
      const tasks = await t.evaluatePerspective("flagged" as BuiltinPerspectiveId);
      expect(Array.isArray(tasks)).toBe(true);
    });

    it("returns an array for the Projects perspective", async () => {
      const tasks = await t.evaluatePerspective("projects" as BuiltinPerspectiveId);
      expect(Array.isArray(tasks)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // evaluateCustomPerspective — JXA cannot do custom perspectives
  // -------------------------------------------------------------------------

  describe("evaluateCustomPerspective", () => {
    it("throws ScriptError with omnijs-only reason (no live OF needed)", async () => {
      const err = await t.evaluateCustomPerspective("any-custom-id").catch((e) => e);
      expect(err).toBeInstanceOf(ScriptError);
      expect((err as ScriptError).details?.reason).toBe("omnijs-only");
      expect((err as ScriptError).details?.transport).toBe("jxa");
    });
  });
});
