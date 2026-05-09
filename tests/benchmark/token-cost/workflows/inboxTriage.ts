/**
 * Fixture workflow — bulk inbox triage (#771).
 *
 * Captures the high-frequency "I dumped 20 things into my inbox; help me
 * sort them" pattern. Exercises the heaviest read+write surface in the
 * server: bulk creation, list with note bodies, batch updates that flag
 * + assign tags + set defer dates, and a partial completion sweep.
 *
 * Notes are deliberately multi-KB so downstream truncation work (#775)
 * shows measurable effect against this baseline.
 */

import { handleTagCreate } from "../../../../src/tools/tag/create.js";
import { handleTaskBatchAssign } from "../../../../src/tools/task/batchAssign.js";
import { handleTaskBatchComplete } from "../../../../src/tools/task/batchComplete.js";
import { handleTaskBatchCreate } from "../../../../src/tools/task/batchCreate.js";
import { handleTaskList } from "../../../../src/tools/task/list.js";
import { Bench, type BenchToolContext } from "../runBench.js";

const NOTE_TEMPLATE =
  "Captured from email thread. Stakeholders: alex@example.com, jamie@example.com. " +
  "Background: this dropped out of the planning sync on Tuesday and needs a decision before Friday. " +
  "Open questions: budget envelope, owning team, dependency on the migration epic. " +
  "Links: https://example.com/wiki/topic, https://example.com/jira/ABC-123. ";

function inboxItems(count: number) {
  const items: Array<{ name: string; note: string; flagged?: boolean }> = [];
  for (let i = 0; i < count; i += 1) {
    items.push({
      name: `Triage candidate ${String(i + 1).padStart(2, "0")} — capture from inbox`,
      note: NOTE_TEMPLATE.repeat(3 + (i % 3)),
      flagged: i % 4 === 0,
    });
  }
  return items;
}

export async function runInboxTriage(ctx: BenchToolContext): Promise<Bench> {
  const bench = new Bench("inbox-triage");

  // 1) Create a tag the triager assigns to actionable items.
  const tagInput = { name: "@actionable" };
  const tagEnv = await bench.call("tag_create", tagInput, () =>
    handleTagCreate(tagInput, { tagService: ctx.tagService, makeMeta: ctx.makeMeta }),
  );
  if (!("data" in tagEnv)) throw new Error("tag_create did not succeed");
  const tagId = tagEnv.data.tag.id;

  // 2) Capture 20 inbox items in one batch.
  const createInput = { items: inboxItems(20) };
  const createEnv = await bench.call("task_batch_create", createInput, () =>
    handleTaskBatchCreate(createInput, {
      adapter: ctx.adapter,
      makeMeta: ctx.makeMeta,
      cache: ctx.cache,
    }),
  );
  if (!("data" in createEnv)) throw new Error("task_batch_create did not succeed");
  const ids = createEnv.data.created.map((c) => c.value.id);

  // 3) Triager pulls the inbox to review what landed.
  const listInput = { inbox: true, limit: 50 };
  await bench.call("task_list", listInput, () =>
    handleTaskList(listInput, { taskService: ctx.taskService, makeMeta: ctx.makeMeta }),
  );

  // 4) Triage assignments — flag, tag, defer in one round trip.
  const assignInput = {
    assignments: ids.map((id, i) => ({
      taskId: id,
      flagged: true,
      addTagIds: [tagId],
      ...(i % 2 === 0 && { deferDate: "2026-05-02T08:00:00.000Z" }),
    })),
  };
  await bench.call("task_batch_assign", assignInput, () =>
    handleTaskBatchAssign(assignInput, {
      adapter: ctx.adapter,
      makeMeta: ctx.makeMeta,
      cache: ctx.cache,
    }),
  );

  // 5) Complete the first five during the triage pass.
  const completeInput = { items: ids.slice(0, 5).map((id) => ({ id })) };
  await bench.call("task_batch_complete", completeInput, () =>
    handleTaskBatchComplete(completeInput, {
      adapter: ctx.adapter,
      makeMeta: ctx.makeMeta,
      cache: ctx.cache,
    }),
  );

  // 6) Final list — confirm what's still on the plate. The triager only needs
  //    name + status flags here, not the multi-KB notes again, so use the
  //    field projection from #773 to keep the readback lean.
  const finalListInput = {
    inbox: true,
    completed: "exclude" as const,
    limit: 50,
    fields: ["name", "flagged", "tagIds", "deferDate"],
  };
  await bench.call("task_list", finalListInput, () =>
    handleTaskList(finalListInput, { taskService: ctx.taskService, makeMeta: ctx.makeMeta }),
  );

  return bench;
}
