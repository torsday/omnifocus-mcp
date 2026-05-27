/**
 * runBench parent-side tests — exercises {@link runAllWorkflows} with an
 * injected {@link WorkerLauncher} so we never spawn a real worker (no
 * `tsx`, no OmniFocus, no `osascript`).
 */

import { describe, expect, test } from "vitest";
import { runAllWorkflows, type WorkerLauncher } from "./runBench.js";
import type { ScriptCallEvent, WorkerOutput } from "./types.js";
import { workflowNames } from "./workflows.js";

function evt(seq: number, scriptName: string, durationMs: number): ScriptCallEvent {
  return { transport: "jxa", scriptName, durationMs, outcome: "ok", sequence: seq };
}

describe("runAllWorkflows", () => {
  test("spawns one worker per registered workflow and aggregates each", async () => {
    const launches: string[] = [];
    const launcher: WorkerLauncher = (workflow): Promise<WorkerOutput> => {
      launches.push(workflow);
      return Promise.resolve({
        workflow,
        workflowDurationMs: 100,
        events: [
          evt(0, "task_list", 500), // cold
          evt(1, "task_list", 50), // warm
        ],
      });
    };

    const out = await runAllWorkflows(launcher);

    expect(launches).toEqual([...workflowNames()]);
    expect(out).toHaveLength(workflowNames().length);
    for (const spawn of out) {
      expect(spawn.result.callCount).toBe(2);
      expect(spawn.result.byScript.task_list?.coldP95Ms).toBe(500);
      expect(spawn.result.byScript.task_list?.warmP95Ms).toBe(50);
    }
  });

  test("propagates worker-side errors through `raw.error`", async () => {
    const launcher: WorkerLauncher = (workflow) =>
      Promise.resolve({
        workflow,
        workflowDurationMs: 0,
        events: [],
        error: "OmniFocusNotRunning: app isn't running",
      });
    const out = await runAllWorkflows(launcher);
    expect(out[0]?.raw.error).toMatch(/OmniFocusNotRunning/);
    // Aggregation still produces a (zeroed) rollup so callers see a stable shape.
    expect(out[0]?.result.callCount).toBe(0);
  });

  test("runs workflows sequentially — no overlapping launcher invocations", async () => {
    let inflight = 0;
    let maxInflight = 0;
    const launcher: WorkerLauncher = async (workflow) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight -= 1;
      return { workflow, workflowDurationMs: 5, events: [] };
    };
    await runAllWorkflows(launcher);
    expect(maxInflight).toBe(1);
  });
});
