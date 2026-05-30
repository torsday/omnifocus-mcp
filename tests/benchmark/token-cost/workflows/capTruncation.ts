/**
 * Fixture workflow — maxOutputBytes cap truncation (#1062).
 *
 * Proves the byte cap (#776 → #1060) actually bounds wire size: seeds a project
 * with 60 tasks, then calls `task_list` once at `{ limit: 50 }` (the full,
 * uncapped page) and once with a fixed `maxOutputBytes` that the full page
 * exceeds. The capped call returns a strictly smaller, bounded payload.
 *
 * The gate-sensitive shapes this surfaces:
 *   - uncapped vs. capped `task_list` response bytes for the same query, so a
 *     regression that defeats the cap (returns the full page anyway) shows up as
 *     the capped call's byte count drifting up toward the uncapped one;
 *   - the truncation-envelope overhead (`meta.truncatedAtCap` + the
 *     `WARN_RESULT_TRUNCATED` warning + cursor).
 *
 * Determinism: the cap is a fixed byte value (not derived from runtime sizes),
 * so the seeded data + cap pin both calls to stable byte counts for the
 * snapshot. The inline asserts fail the bench (like `largePagination`) if the
 * contract regresses — they are correctness guards, not just measurements.
 *
 * Coverage matrix lives in `docs/benchmarks/coverage-matrix.md`.
 */

import { handleTaskList } from "../../../../src/tools/task/list.js";
import { Bench, type BenchToolContext } from "../runBench.js";

const TASK_NOTE =
  "Routine action; revisit owner & deadline at end-of-week. " +
  "Background captured in adjacent thread.";

/** Fixed cap (bytes). Large enough to keep several tasks, small enough that the
 *  50-task page is truncated well before its natural boundary. */
const CAP_BYTES = 4096;

async function seedCapDatabase(ctx: BenchToolContext): Promise<void> {
  const projectId = await ctx.adapter.createProject({
    name: "Cap-truncation fixture",
    note: "60 tasks for the byte-cap truncation shape.",
  });
  for (let t = 0; t < 60; t += 1) {
    await ctx.adapter.createTask({
      name: `capped item ${String(t + 1).padStart(3, "0")}`,
      projectId,
      note: TASK_NOTE,
    });
  }
}

export async function runCapTruncation(ctx: BenchToolContext): Promise<Bench> {
  const bench = new Bench("cap-truncation");

  await seedCapDatabase(ctx);

  // 1. Full page (no cap) — the baseline the cap is measured against.
  const fullInput = { limit: 50 };
  const full = await bench.call("task_list", fullInput, () =>
    handleTaskList(fullInput, { taskService: ctx.taskService, makeMeta: ctx.makeMeta }),
  );
  if (!("data" in full)) throw new Error("uncapped task_list did not succeed");

  // 2. Same query, byte-capped — must truncate and stay within the cap.
  const cappedInput = { limit: 50, maxOutputBytes: CAP_BYTES };
  const capped = await bench.call("task_list", cappedInput, () =>
    handleTaskList(cappedInput, { taskService: ctx.taskService, makeMeta: ctx.makeMeta }),
  );
  if (!("data" in capped)) throw new Error("capped task_list did not succeed");

  // Contract guards (fail the bench on regression, mirroring largePagination).
  if (capped.meta.truncatedAtCap !== true) {
    throw new Error("cap-truncation: expected meta.truncatedAtCap = true");
  }
  if ((capped.meta.bytesReturned ?? Number.POSITIVE_INFINITY) > CAP_BYTES) {
    throw new Error(
      `cap-truncation: bytesReturned ${capped.meta.bytesReturned} exceeds cap ${CAP_BYTES}`,
    );
  }
  if (capped.data.tasks.length >= full.data.tasks.length) {
    throw new Error("cap-truncation: capped page should hold fewer tasks than the full page");
  }
  const hasWarning = capped.meta.warnings?.some((w) => w.code === "WARN_RESULT_TRUNCATED") ?? false;
  if (!hasWarning) {
    throw new Error("cap-truncation: expected a WARN_RESULT_TRUNCATED warning");
  }

  return bench;
}
