/**
 * Central registry of every tool's input schema (as a ZodObject).
 *
 * Parallel to allDescriptions.ts — add a new entry here whenever a new tool
 * is introduced and has an input schema.
 *
 * Note: for tools whose exported schema is a ZodEffects (z.object().refine(...)),
 * we import and use the underlying base ZodObject so that shape introspection
 * works correctly (ZodEffects lacks .shape).
 */

import { z } from "zod";
import {
  attachmentAddInputSchema,
  attachmentListInputSchema,
  attachmentRemoveInputSchema,
  attachmentSaveToPathInputSchema,
} from "./attachment/index.js";
import { importOpmlInputSchema } from "./export/opml_import.js";
import { exportTaskPaperInputSchema, importTaskPaperInputSchema } from "./export/taskpaper.js";
import { folderCreateInputSchema } from "./folder/create.js";
import { folderDeleteInputSchema } from "./folder/delete.js";
import { folderGetInputSchema } from "./folder/get.js";
import { folderListInputSchema } from "./folder/list.js";
import { folderMoveInputSchema } from "./folder/move.js";
import { folderUpdateInputSchema } from "./folder/update.js";
import { noteAppendInputSchema } from "./note/append.js";
import { noteGetInputSchema } from "./note/get.js";
import { noteGetHtmlInputSchema } from "./note/get_html.js";
import { noteSetInputSchema } from "./note/set.js";
import { noteSetHtmlInputSchema } from "./note/set_html.js";
import { perspectiveCreateInputSchema } from "./perspective/create.js";
import { perspectiveDeleteInputSchema } from "./perspective/delete.js";
import { perspectiveEvaluateInputSchema } from "./perspective/evaluate.js";
import { perspectiveGetInputSchema } from "./perspective/get.js";
import { perspectiveListInputSchema } from "./perspective/list.js";
import { perspectiveUpdateInputSchema } from "./perspective/update.js";
import { projectCompleteInputSchema } from "./project/complete.js";
import { projectCreateInputSchema } from "./project/create.js";
import { projectDeleteInputSchema } from "./project/delete.js";
import { projectDropInputSchema } from "./project/drop.js";
import { projectGetInputSchema } from "./project/get.js";
import { projectListInputSchema } from "./project/list.js";
import { projectMoveInputSchema } from "./project/move.js";
import { projectUpdateInputSchema } from "./project/update.js";
import { runJxaScriptInputSchema } from "./rawScript/jxa.js";
import { runOmniJsScriptInputSchema } from "./rawScript/omnijs.js";
import { reviewListDueInputSchema } from "./review/listDue.js";
import { reviewMarkReviewedInputSchema } from "./review/markReviewed.js";
import { projectMarkReviewedInputSchema } from "./review/projectMarkReviewed.js";
import { reviewSetIntervalInputSchema } from "./review/setInterval.js";
import { searchQueryInputSchema } from "./search/query.js";
import { syncStatusInputSchema } from "./sync/status.js";
import { syncTriggerInputSchema } from "./sync/trigger.js";
import { tagCreateInputSchema } from "./tag/create.js";
import { tagDeleteInputSchema } from "./tag/delete.js";
import { tagGetInputSchema } from "./tag/get.js";
import { tagGetLocationInputSchema } from "./tag/getLocation.js";
import { tagListInputSchema } from "./tag/list.js";
import { tagMoveInputSchema } from "./tag/move.js";
import { tagSetAllowsNextActionInputSchema } from "./tag/setAllowsNextAction.js";
import { tagSetLocationInputSchema } from "./tag/setLocation.js";
import { tagSetStatusInputSchema } from "./tag/setStatus.js";
import { tagUpdateInputSchema } from "./tag/update.js";
import { taskBatchDeferSmartInputSchema } from "./task/batchDeferSmart.js";
import { taskClearRepetitionInputSchema } from "./task/clearRepetition.js";
import { taskCompleteInputSchema } from "./task/complete.js";
import { taskCreateInputSchema } from "./task/create.js";
import { taskDeferSmartInputSchema } from "./task/deferSmart.js";
import { taskDeleteInputSchema } from "./task/delete.js";
import { taskDropInputSchema } from "./task/drop.js";
import { taskFindByNameInputSchema } from "./task/findByName.js";
import { taskGetInputSchema } from "./task/get.js";
import { taskGetManyInputSchema } from "./task/getMany.js";
import { taskListInputSchema } from "./task/list.js";
// task_search uses the base shape (ZodObject) — the exported schema is ZodEffects
import { taskSearchInputShape } from "./task/search.js";
import { taskSetRepetitionInputSchema } from "./task/setRepetition.js";
import { taskUncompleteInputSchema } from "./task/uncomplete.js";
import { taskUndropInputSchema } from "./task/undrop.js";
// task_update uses the base schema (ZodObject) — the exported schema is ZodEffects
import { taskUpdateInputBaseSchema } from "./task/update.js";

export const ALL_INPUT_SCHEMAS: Record<string, z.ZodObject<z.ZodRawShape>> = {
  attachment_list: attachmentListInputSchema,
  attachment_add: attachmentAddInputSchema,
  attachment_remove: attachmentRemoveInputSchema,
  attachment_save_to_path: attachmentSaveToPathInputSchema,
  export_taskpaper: exportTaskPaperInputSchema,
  folder_create: folderCreateInputSchema,
  folder_delete: folderDeleteInputSchema,
  folder_get: folderGetInputSchema,
  folder_list: folderListInputSchema,
  folder_move: folderMoveInputSchema,
  folder_update: folderUpdateInputSchema,
  import_opml: importOpmlInputSchema,
  import_taskpaper: importTaskPaperInputSchema,
  note_append: noteAppendInputSchema,
  note_get: noteGetInputSchema,
  note_get_html: noteGetHtmlInputSchema,
  note_set: noteSetInputSchema,
  note_set_html: noteSetHtmlInputSchema,
  perspective_create: perspectiveCreateInputSchema,
  perspective_delete: perspectiveDeleteInputSchema,
  perspective_evaluate: perspectiveEvaluateInputSchema,
  perspective_get: perspectiveGetInputSchema,
  perspective_list: perspectiveListInputSchema,
  perspective_update: perspectiveUpdateInputSchema,
  project_complete: projectCompleteInputSchema,
  project_create: projectCreateInputSchema,
  project_delete: projectDeleteInputSchema,
  project_drop: projectDropInputSchema,
  project_get: projectGetInputSchema,
  project_list: projectListInputSchema,
  project_mark_reviewed: projectMarkReviewedInputSchema,
  project_move: projectMoveInputSchema,
  project_update: projectUpdateInputSchema,
  review_list_due: reviewListDueInputSchema,
  review_mark_reviewed: reviewMarkReviewedInputSchema,
  review_set_interval: reviewSetIntervalInputSchema,
  run_jxa_script: runJxaScriptInputSchema,
  run_omnijs_script: runOmniJsScriptInputSchema,
  search_query: searchQueryInputSchema,
  sync_status: syncStatusInputSchema,
  sync_trigger: syncTriggerInputSchema,
  tag_create: tagCreateInputSchema,
  tag_delete: tagDeleteInputSchema,
  tag_get: tagGetInputSchema,
  tag_get_location: tagGetLocationInputSchema,
  tag_list: tagListInputSchema,
  tag_move: tagMoveInputSchema,
  tag_set_allows_next_action: tagSetAllowsNextActionInputSchema,
  tag_set_location: tagSetLocationInputSchema,
  tag_set_status: tagSetStatusInputSchema,
  tag_update: tagUpdateInputSchema,
  task_clear_repetition: taskClearRepetitionInputSchema,
  task_complete: taskCompleteInputSchema,
  task_batch_defer_smart: taskBatchDeferSmartInputSchema,
  task_create: taskCreateInputSchema,
  task_defer_smart: taskDeferSmartInputSchema,
  task_delete: taskDeleteInputSchema,
  task_drop: taskDropInputSchema,
  task_find_by_name: taskFindByNameInputSchema,
  task_get: taskGetInputSchema,
  task_get_many: taskGetManyInputSchema,
  task_list: taskListInputSchema,
  task_search: z.object(taskSearchInputShape),
  task_set_repetition: taskSetRepetitionInputSchema,
  task_uncomplete: taskUncompleteInputSchema,
  task_undrop: taskUndropInputSchema,
  task_update: taskUpdateInputBaseSchema,
};
