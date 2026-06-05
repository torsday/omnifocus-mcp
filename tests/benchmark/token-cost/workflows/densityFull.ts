/**
 * Fixture workflow — full-density reads (#818).
 *
 * Exercises the session density lever: with `density: "full"` negotiated at
 * the handshake, read tools default to the rich shape — `_links` attached,
 * subtasks inlined, notes untruncated — without the caller passing any
 * per-call flags. Compared against the default-profile workflows (which run
 * the same read tools at the lean baseline), this workflow's per-tool
 * response bytes quantify what the `full` profile costs / the lean default
 * saves.
 *
 * IMPORTANT: density is a process-level singleton (stdio is the sole
 * transport, ADR-0010). This workflow MUST restore it in a `finally` or it
 * leaks into every workflow that runs after it in the same process, silently
 * inflating their baselines. The reset is the contract that keeps the shared
 * benchmark baseline honest.
 */

import { resetSessionState, setSessionDensity } from "../../../../src/state/sessionState.js";
import { handleTaskBatchCreate } from "../../../../src/tools/task/batchCreate.js";
import { handleTaskGet } from "../../../../src/tools/task/get.js";
import { handleTaskList } from "../../../../src/tools/task/list.js";
import { Bench, type BenchToolContext } from "../runBench.js";

const NOTE_TEMPLATE =
  "Design rationale captured inline. Stakeholders: alex@example.com, jamie@example.com. " +
  "This task carries a multi-KB note so the full-vs-truncated delta is measurable. " +
  "Links: https://example.com/wiki/topic, https://example.com/jira/ABC-123. ";

export async function runDensityFull(ctx: BenchToolContext): Promise<Bench> {
  const bench = new Bench("density-full");

  // Seed a parent task plus children so includeSubtasks has something to
  // inline under the full profile.
  const parentInput = {
    items: [{ name: "Epic — migration tracking", note: NOTE_TEMPLATE.repeat(4) }],
  };
  const parentEnv = await bench.call("task_batch_create", parentInput, () =>
    handleTaskBatchCreate(parentInput, {
      adapter: ctx.adapter,
      makeMeta: ctx.makeMeta,
      cache: ctx.cache,
    }),
  );
  if (!("data" in parentEnv)) throw new Error("parent task_batch_create did not succeed");
  const parent = parentEnv.data.created[0];
  if (parent === undefined) throw new Error("parent task_batch_create returned no item");
  const parentId = parent.value.id;

  const childInput = {
    items: Array.from({ length: 6 }, (_, i) => ({
      name: `Subtask ${String(i + 1).padStart(2, "0")}`,
      note: NOTE_TEMPLATE.repeat(2 + (i % 3)),
      parentId,
    })),
  };
  const childEnv = await bench.call("task_batch_create", childInput, () =>
    handleTaskBatchCreate(childInput, {
      adapter: ctx.adapter,
      makeMeta: ctx.makeMeta,
      cache: ctx.cache,
    }),
  );
  if (!("data" in childEnv)) throw new Error("child task_batch_create did not succeed");

  try {
    // Client negotiated the rich shape once at init. No per-call flags below.
    setSessionDensity("full");

    // Read the page — full profile attaches `_links` and untruncated notes.
    const listInput = { limit: 50 };
    await bench.call("task_list", listInput, () =>
      handleTaskList(listInput, { taskService: ctx.taskService, makeMeta: ctx.makeMeta }),
    );

    // Fetch the parent — full profile inlines subtasks and the whole note.
    const getInput = { id: parentId };
    await bench.call("task_get", getInput, () =>
      handleTaskGet(getInput, { taskService: ctx.taskService, makeMeta: ctx.makeMeta }),
    );
  } finally {
    // Restore the baseline so subsequent workflows measure at default density.
    resetSessionState();
  }

  return bench;
}
