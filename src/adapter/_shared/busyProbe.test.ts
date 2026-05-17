/**
 * Tests for {@link probeOmniFocusResponsiveness} (#817).
 * Covers each path through the result-classification logic with a faked
 * spawner; no actual osascript is invoked.
 */

import { describe, expect, it, vi } from "vitest";
import type { ScriptSpawner, SpawnResult } from "../jxa/scriptRunner.js";
import { probeOmniFocusResponsiveness } from "./busyProbe.js";

function spawnerReturning(
  result: Partial<SpawnResult> & Pick<SpawnResult, "stdout" | "stderr" | "exitCode" | "timedOut">,
): ScriptSpawner {
  return vi.fn().mockResolvedValue(result as SpawnResult);
}

describe("probeOmniFocusResponsiveness", () => {
  it("returns responsive when stdout is non-empty and exit code is 0", async () => {
    const spawner = spawnerReturning({
      stdout: '{"name":"OmniFocus"}',
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });
    expect(await probeOmniFocusResponsiveness(spawner)).toBe("responsive");
  });

  it("returns unresponsive on timeout", async () => {
    const spawner = spawnerReturning({
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut: true,
    });
    expect(await probeOmniFocusResponsiveness(spawner)).toBe("unresponsive");
  });

  it("returns unresponsive on non-zero exit", async () => {
    const spawner = spawnerReturning({
      stdout: "",
      stderr: "error",
      exitCode: 1,
      timedOut: false,
    });
    expect(await probeOmniFocusResponsiveness(spawner)).toBe("unresponsive");
  });

  it("returns unresponsive on empty stdout (even with exit 0)", async () => {
    const spawner = spawnerReturning({
      stdout: "   \n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });
    expect(await probeOmniFocusResponsiveness(spawner)).toBe("unresponsive");
  });

  it("returns unresponsive when spawner reports spawnError", async () => {
    const spawner = spawnerReturning({
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut: false,
      spawnError: Object.assign(new Error("ENOENT"), { code: "ENOENT" }) as NodeJS.ErrnoException,
    });
    expect(await probeOmniFocusResponsiveness(spawner)).toBe("unresponsive");
  });

  it("returns unresponsive (never throws) when the spawner rejects", async () => {
    const spawner: ScriptSpawner = vi.fn().mockRejectedValue(new Error("boom"));
    expect(await probeOmniFocusResponsiveness(spawner)).toBe("unresponsive");
  });

  it("passes the supplied timeoutMs through to the spawner", async () => {
    const spawner = vi.fn().mockResolvedValue({
      stdout: '{"name":"OmniFocus"}',
      stderr: "",
      exitCode: 0,
      timedOut: false,
    } as SpawnResult);
    await probeOmniFocusResponsiveness(spawner, 250);
    expect(spawner).toHaveBeenCalledWith(expect.any(String), "{}", 250);
  });
});
