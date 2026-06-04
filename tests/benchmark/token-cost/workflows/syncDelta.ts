/**
 * Fixture workflow — incremental sync via `changes_since` (#819).
 *
 * Demonstrates the field-level delta payoff: bootstrap once (full snapshot),
 * mutate a few tasks, then poll for changes. The delta call returns only the
 * changed fields of the touched tasks — its response bytes are a fraction of
 * the bootstrap snapshot, which is the whole point of the sync protocol.
 *
 * The `changes_since` snapshot store is per-call here (fresh instance), so
 * this workflow is self-contained and leaves no process state behind.
 */

import { SyncSnapshotStore } from "../../../../src/state/syncSnapshotStore.js";
import {
  type ChangesSinceData,
  handleChangesSince,
} from "../../../../src/tools/sync/changesSince.js";
import { handleTaskBatchAssign } from "../../../../src/tools/task/batchAssign.js";
import { handleTaskBatchCreate } from "../../../../src/tools/task/batchCreate.js";
import { Bench, type BenchToolContext } from "../runBench.js";

const NOTE = "Sync-tracked task. ".repeat(20);

export async function runSyncDelta(ctx: BenchToolContext): Promise<Bench> {
  const bench = new Bench("sync-delta");
  const store = new SyncSnapshotStore();
  const syncCtx = { adapter: ctx.adapter, makeMeta: ctx.makeMeta, store };

  // Seed a workspace the consumer will track.
  const createInput = {
    items: Array.from({ length: 25 }, (_, i) => ({
      name: `Tracked task ${String(i + 1).padStart(2, "0")}`,
      note: NOTE,
    })),
  };
  const createEnv = await bench.call("task_batch_create", createInput, () =>
    handleTaskBatchCreate(createInput, {
      adapter: ctx.adapter,
      makeMeta: ctx.makeMeta,
      cache: ctx.cache,
    }),
  );
  if (!("data" in createEnv)) throw new Error("task_batch_create did not succeed");
  const ids = createEnv.data.created.map((c) => c.value.id);

  // Bootstrap: the consumer's first sync — full snapshot + token.
  const bootEnv = await bench.call("changes_since", {}, () => handleChangesSince({}, syncCtx));
  if (!("data" in bootEnv)) throw new Error("changes_since bootstrap did not succeed");
  const syncToken = (bootEnv.data as ChangesSinceData).syncToken;

  // The consumer flags three tasks (a typical small edit burst).
  const assignInput = { assignments: ids.slice(0, 3).map((id) => ({ taskId: id, flagged: true })) };
  await bench.call("task_batch_assign", assignInput, () =>
    handleTaskBatchAssign(assignInput, {
      adapter: ctx.adapter,
      makeMeta: ctx.makeMeta,
      cache: ctx.cache,
    }),
  );

  // Delta poll: only the three changed tasks' changed fields come back.
  await bench.call("changes_since", { syncToken }, () =>
    handleChangesSince({ syncToken }, syncCtx),
  );

  return bench;
}
