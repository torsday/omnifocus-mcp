/**
 * Fixture workflow — project planning sequence (#771).
 *
 * Captures the LLM-driven "spin up a new project from scratch" pattern:
 * create the project, drop ten tasks under it, attach a tag for tracking,
 * batch-assign the tag and a defer date, then read the project back to
 * confirm. Mirrors the project_planning prompt template registered with
 * the server so the benchmark tracks a workflow agents actually use.
 */

import type { ProjectId } from "../../../../src/domain/ids.js";
import { handleProjectCreate } from "../../../../src/tools/project/create.js";
import { handleProjectGet } from "../../../../src/tools/project/get.js";
import { handleTagCreate } from "../../../../src/tools/tag/create.js";
import { handleTaskBatchAssign } from "../../../../src/tools/task/batchAssign.js";
import { handleTaskBatchCreate } from "../../../../src/tools/task/batchCreate.js";
import { handleTaskList } from "../../../../src/tools/task/list.js";
import { Bench, type BenchToolContext } from "../runBench.js";

function planTasks(projectId: ProjectId, count: number) {
  const phases = ["draft", "review", "build", "test", "ship"];
  return Array.from({ length: count }, (_, i) => ({
    name: `${phases[i % phases.length]} — milestone ${String(Math.floor(i / phases.length) + 1)}`,
    projectId,
    note: `Acceptance criteria for step ${i + 1}: confirm scope, draft handoff, capture decisions in ADR.`,
  }));
}

export async function runProjectPlanning(ctx: BenchToolContext): Promise<Bench> {
  const bench = new Bench("project-planning");

  // 1) Spin up the project.
  const projectInput = {
    name: "Q3 launch readiness",
    note: "Cross-team launch coordination. Owners: PM, EM, design. Deadline target: end of quarter.",
    completionCriterion: "sequential" as const,
  };
  const projEnv = await bench.call("project_create", projectInput, () =>
    handleProjectCreate(projectInput, {
      adapter: ctx.adapter,
      makeMeta: ctx.makeMeta,
      cache: ctx.cache,
    }),
  );
  if (!("data" in projEnv)) throw new Error("project_create did not succeed");
  const projectId = projEnv.data.id;

  // 2) Add a tag the planner uses to flag launch-blocking work.
  const tagInput = { name: "@launch-blocker" };
  const tagEnv = await bench.call("tag_create", tagInput, () =>
    handleTagCreate(tagInput, { tagService: ctx.tagService, makeMeta: ctx.makeMeta }),
  );
  if (!("data" in tagEnv)) throw new Error("tag_create did not succeed");
  const tagId = tagEnv.data.tag.id;

  // 3) Drop ten tasks into the project in one round trip.
  const tasksInput = { items: planTasks(projectId, 10) };
  const tasksEnv = await bench.call("task_batch_create", tasksInput, () =>
    handleTaskBatchCreate(tasksInput, {
      adapter: ctx.adapter,
      makeMeta: ctx.makeMeta,
      cache: ctx.cache,
    }),
  );
  if (!("data" in tasksEnv)) throw new Error("task_batch_create did not succeed");
  const taskIds = tasksEnv.data.created.map((c) => c.value.id);

  // 4) Tag every other task as a launch blocker, set a uniform defer date.
  const assignInput = {
    assignments: taskIds.map((id, i) => ({
      taskId: id,
      ...(i % 2 === 0 && { addTagIds: [tagId] }),
      deferDate: "2026-05-15T08:00:00.000Z",
    })),
  };
  await bench.call("task_batch_assign", assignInput, () =>
    handleTaskBatchAssign(assignInput, {
      adapter: ctx.adapter,
      makeMeta: ctx.makeMeta,
      cache: ctx.cache,
    }),
  );

  // 5) Read the project back to confirm structure (project_get).
  const getInput = { id: projectId };
  await bench.call("project_get", getInput, () =>
    handleProjectGet(getInput, { projectService: ctx.projectService, makeMeta: ctx.makeMeta }),
  );

  // 6) Read the project's task list (post-planning view).
  const listInput = { projectId, limit: 50 };
  await bench.call("task_list", listInput, () =>
    handleTaskList(listInput, { taskService: ctx.taskService, makeMeta: ctx.makeMeta }),
  );

  return bench;
}
