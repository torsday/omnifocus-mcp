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
import { appLaunchInputSchema } from "./app/launch.js";
import {
  attachmentAddInputSchema,
  attachmentCreateInputSchema,
  attachmentDeleteInputSchema,
  attachmentListInputSchema,
  attachmentRemoveInputSchema,
  attachmentSaveToPathInputSchema,
} from "./attachment/index.js";
import { databaseRedoInputSchema } from "./database/redo.js";
import { databaseUndoInputSchema } from "./database/undo.js";
import { decisionClearInputSchema } from "./decision/clear.js";
import { decisionRecordInputSchema } from "./decision/record.js";
import { exportOpmlInputSchema } from "./export/opml.js";
import { importOpmlInputSchema } from "./export/opml_import.js";
import { exportTaskPaperInputSchema, importTaskPaperInputSchema } from "./export/taskpaper.js";
import { folderCreateInputSchema } from "./folder/create.js";
import { folderDeleteInputSchema } from "./folder/delete.js";
import { folderGetInputSchema } from "./folder/get.js";
import { folderListInputSchema } from "./folder/list.js";
import { folderMoveInputSchema } from "./folder/move.js";
import { folderUpdateInputSchema } from "./folder/update.js";
import { forecastGetInputSchema } from "./forecast/get.js";
import { forecastGetTagInputSchema } from "./forecast/get_tag.js";
import { forecastPackInputSchema } from "./forecast/pack.js";
import { forecastSetTagInputSchema } from "./forecast/set_tag.js";
import { omnifocusDoctorInputSchema } from "./lifecycle/doctor.js";
import { noteAppendInputSchema } from "./note/append.js";
import { noteGetInputSchema } from "./note/get.js";
import { noteGetHtmlInputSchema } from "./note/get_html.js";
import { noteSetInputSchema } from "./note/set.js";
import { noteSetHtmlInputSchema } from "./note/set_html.js";
import { internalStatusInputSchema } from "./observability/internalStatus.js";
import { perspectiveCreateInputSchema } from "./perspective/create.js";
import { perspectiveDeleteInputSchema } from "./perspective/delete.js";
import { perspectiveEvaluateInputSchema } from "./perspective/evaluate.js";
import { perspectiveEvaluateDryRunInputSchema } from "./perspective/evaluateDryRun.js";
import { perspectiveGetInputSchema } from "./perspective/get.js";
import { perspectiveListInputSchema } from "./perspective/list.js";
import { perspectiveUpdateInputSchema } from "./perspective/update.js";
import { pluginInvokeInputSchema } from "./plugin/invoke.js";
import { projectBatchCompleteInputSchema } from "./project/batchComplete.js";
import { projectBatchDropInputSchema } from "./project/batchDrop.js";
import { projectCompleteInputSchema } from "./project/complete.js";
import { projectCreateInputSchema } from "./project/create.js";
import { projectDeleteInputSchema } from "./project/delete.js";
import { projectDropInputSchema } from "./project/drop.js";
import { projectGetInputSchema } from "./project/get.js";
import { projectGetManyInputSchema } from "./project/getMany.js";
import { projectListInputSchema } from "./project/list.js";
import { projectMoveInputSchema } from "./project/move.js";
import { projectTemplateDeleteInputSchema } from "./project/templateDelete.js";
import { projectTemplateInstantiateInputSchema } from "./project/templateInstantiate.js";
import { projectTemplateListInputSchema } from "./project/templateList.js";
import { projectTemplateSaveInputSchema } from "./project/templateSave.js";
import { projectUpdateInputSchema } from "./project/update.js";
import { runJxaScriptInputSchema } from "./rawScript/jxa.js";
import { runOmniJsScriptInputSchema } from "./rawScript/omnijs.js";
import { repetitionFromProseInputSchema } from "./repetition/fromProse.js";
import { reviewListDueInputSchema } from "./review/listDue.js";
import { reviewMarkReviewedInputSchema } from "./review/markReviewed.js";
import { projectMarkReviewedInputSchema } from "./review/projectMarkReviewed.js";
import { reviewSetIntervalInputSchema } from "./review/setInterval.js";
import { projectSetNextReviewDateInputSchema } from "./review/setNextReviewDate.js";
import { searchQueryInputSchema } from "./search/query.js";
import { changesSinceInputSchema } from "./sync/changesSince.js";
import { syncStatusInputSchema } from "./sync/status.js";
import { syncTriggerInputSchema } from "./sync/trigger.js";
import { tagCreateInputSchema } from "./tag/create.js";
import { tagDeleteInputSchema } from "./tag/delete.js";
import { tagGetInputSchema } from "./tag/get.js";
import { tagGetLocationInputSchema } from "./tag/getLocation.js";
import { tagGetManyInputSchema } from "./tag/getMany.js";
import { tagListInputSchema } from "./tag/list.js";
import { tagMoveInputSchema } from "./tag/move.js";
import { tagSetAllowsNextActionInputSchema } from "./tag/setAllowsNextAction.js";
import { tagSetLocationInputSchema } from "./tag/setLocation.js";
import { tagSetStatusInputSchema } from "./tag/setStatus.js";
import { tagUpdateInputSchema } from "./tag/update.js";
import { taskBatchAssignInputSchema } from "./task/batchAssign.js";
import { taskBatchCompleteInputBaseSchema } from "./task/batchComplete.js";
import { taskBatchCreateInputBaseSchema } from "./task/batchCreate.js";
import { taskBatchDeferSmartInputSchema } from "./task/batchDeferSmart.js";
import { taskBatchDeleteInputSchema } from "./task/batchDelete.js";
import { taskBatchDropInputSchema } from "./task/batchDrop.js";
import { taskBatchMoveInputSchema } from "./task/batchMove.js";
import { taskBatchUncompleteInputSchema } from "./task/batchUncomplete.js";
import { taskBatchUndropInputSchema } from "./task/batchUndrop.js";
import { taskBatchUpdateInputBaseSchema } from "./task/batchUpdate.js";
import { taskClearAlarmsInputSchema } from "./task/clearAlarms.js";
import { taskClearRepetitionInputSchema } from "./task/clearRepetition.js";
import { taskCompleteInputSchema } from "./task/complete.js";
import { taskConvertToProjectInputSchema } from "./task/convertToProject.js";
import { taskCreateInputSchema } from "./task/create.js";
import { taskDeferSmartInputSchema } from "./task/deferSmart.js";
import { taskDeleteInputSchema } from "./task/delete.js";
import { taskDropInputSchema } from "./task/drop.js";
import { taskDuplicateInputSchema } from "./task/duplicate.js";
// task_extract_from_image uses the base shape (ZodObject) — the exported schema is ZodEffects
import { taskExtractFromImageInputBaseSchema } from "./task/extractFromImage.js";
// task_extract_from_note uses the base shape (ZodObject) — the exported schema is ZodEffects
import { taskExtractFromNoteInputBaseSchema } from "./task/extractFromNote.js";
import { taskFindByNameInputSchema } from "./task/findByName.js";
import { taskFindSimilarInputSchema } from "./task/findSimilar.js";
import { taskGetInputSchema } from "./task/get.js";
import { taskGetManyInputSchema } from "./task/getMany.js";
import { taskListInputSchema } from "./task/list.js";
import { taskMoveInputSchema } from "./task/move.js";
import { taskParseTransportTextInputSchema } from "./task/parseTransportText.js";
// task_reclassify uses the base shape (ZodObject) — the exported schema is ZodEffects
import { taskReclassifyInputBaseSchema } from "./task/reclassify.js";
import { taskReorderInputSchema } from "./task/reorder.js";
// task_search uses the base shape (ZodObject) — the exported schema is ZodEffects
import { taskSearchInputShape } from "./task/search.js";
import { taskSetAlarmsInputSchema } from "./task/setAlarms.js";
import { taskSetRepetitionInputSchema } from "./task/setRepetition.js";
import { taskUncompleteInputSchema } from "./task/uncomplete.js";
import { taskUndropInputSchema } from "./task/undrop.js";
// task_update uses the base schema (ZodObject) — the exported schema is ZodEffects
import { taskUpdateInputBaseSchema } from "./task/update.js";
import { taskClearWaitingOnInputSchema, taskSetWaitingOnInputSchema } from "./task/waitingOn.js";
import { webhookDeleteInputSchema } from "./webhook/delete.js";
import { webhookListInputSchema } from "./webhook/list.js";
import { webhookRegisterInputSchema } from "./webhook/register.js";
import { webhookTestInputSchema } from "./webhook/test.js";
import {
  appWindowNewInputSchema,
  appWindowNewTabInputSchema,
  windowGetStateInputSchema,
  windowSetFocusInputSchema,
  windowSetPerspectiveInputSchema,
} from "./window/index.js";

export const ALL_INPUT_SCHEMAS: Record<string, z.ZodObject<z.ZodRawShape>> = {
  app_launch: appLaunchInputSchema,
  app_window_new: appWindowNewInputSchema,
  app_window_new_tab: appWindowNewTabInputSchema,
  attachment_list: attachmentListInputSchema,
  attachment_add: attachmentAddInputSchema,
  attachment_create: attachmentCreateInputSchema,
  attachment_delete: attachmentDeleteInputSchema,
  attachment_remove: attachmentRemoveInputSchema,
  attachment_save_to_path: attachmentSaveToPathInputSchema,
  database_redo: databaseRedoInputSchema,
  database_undo: databaseUndoInputSchema,
  decision_clear: decisionClearInputSchema,
  decision_record: decisionRecordInputSchema,
  export_opml: exportOpmlInputSchema,
  export_taskpaper: exportTaskPaperInputSchema,
  // describe variants share the same input shape as their write counterpart
  folder_create: folderCreateInputSchema,
  folder_create_describe: folderCreateInputSchema,
  folder_delete: folderDeleteInputSchema,
  folder_delete_describe: folderDeleteInputSchema,
  folder_get: folderGetInputSchema,
  folder_list: folderListInputSchema,
  folder_move: folderMoveInputSchema,
  folder_move_describe: folderMoveInputSchema,
  folder_update: folderUpdateInputSchema,
  folder_update_describe: folderUpdateInputSchema,
  forecast_get: forecastGetInputSchema,
  forecast_get_tag: forecastGetTagInputSchema,
  forecast_pack: forecastPackInputSchema,
  forecast_set_tag: forecastSetTagInputSchema,
  import_opml: importOpmlInputSchema,
  import_taskpaper: importTaskPaperInputSchema,
  internal_status: internalStatusInputSchema,
  note_append: noteAppendInputSchema,
  note_get: noteGetInputSchema,
  note_get_html: noteGetHtmlInputSchema,
  note_set: noteSetInputSchema,
  note_set_html: noteSetHtmlInputSchema,
  omnifocus_doctor: omnifocusDoctorInputSchema,
  perspective_create: perspectiveCreateInputSchema,
  perspective_delete: perspectiveDeleteInputSchema,
  perspective_evaluate: perspectiveEvaluateInputSchema,
  perspective_evaluate_dry_run: perspectiveEvaluateDryRunInputSchema,
  perspective_get: perspectiveGetInputSchema,
  perspective_list: perspectiveListInputSchema,
  perspective_update: perspectiveUpdateInputSchema,
  plugin_invoke: pluginInvokeInputSchema,
  project_batch_complete: projectBatchCompleteInputSchema,
  project_batch_drop: projectBatchDropInputSchema,
  project_complete: projectCompleteInputSchema,
  project_complete_describe: projectCompleteInputSchema,
  project_create: projectCreateInputSchema,
  project_create_describe: projectCreateInputSchema,
  project_delete: projectDeleteInputSchema,
  project_delete_describe: projectDeleteInputSchema,
  project_drop: projectDropInputSchema,
  project_drop_describe: projectDropInputSchema,
  project_get: projectGetInputSchema,
  project_get_many: projectGetManyInputSchema,
  project_list: projectListInputSchema,
  project_mark_reviewed: projectMarkReviewedInputSchema,
  project_move: projectMoveInputSchema,
  project_move_describe: projectMoveInputSchema,
  project_set_next_review_date: projectSetNextReviewDateInputSchema,
  project_template_delete: projectTemplateDeleteInputSchema,
  project_template_instantiate: projectTemplateInstantiateInputSchema,
  project_template_list: projectTemplateListInputSchema,
  project_template_save: projectTemplateSaveInputSchema,
  project_update: projectUpdateInputSchema,
  project_update_describe: projectUpdateInputSchema,
  repetition_from_prose: repetitionFromProseInputSchema,
  review_list_due: reviewListDueInputSchema,
  review_mark_reviewed: reviewMarkReviewedInputSchema,
  review_set_interval: reviewSetIntervalInputSchema,
  run_jxa_script: runJxaScriptInputSchema,
  changes_since: changesSinceInputSchema,
  run_omnijs_script: runOmniJsScriptInputSchema,
  search_query: searchQueryInputSchema,
  sync_status: syncStatusInputSchema,
  sync_trigger: syncTriggerInputSchema,
  tag_create: tagCreateInputSchema,
  tag_create_describe: tagCreateInputSchema,
  tag_delete: tagDeleteInputSchema,
  tag_delete_describe: tagDeleteInputSchema,
  tag_get: tagGetInputSchema,
  tag_get_location: tagGetLocationInputSchema,
  tag_get_many: tagGetManyInputSchema,
  tag_list: tagListInputSchema,
  tag_move: tagMoveInputSchema,
  tag_move_describe: tagMoveInputSchema,
  tag_set_allows_next_action: tagSetAllowsNextActionInputSchema,
  tag_set_location: tagSetLocationInputSchema,
  tag_set_status: tagSetStatusInputSchema,
  tag_update: tagUpdateInputSchema,
  tag_update_describe: tagUpdateInputSchema,
  task_batch_assign: taskBatchAssignInputSchema,
  // task_batch_complete uses the base schema (ZodObject) — the exported schema is ZodEffects
  task_batch_complete: taskBatchCompleteInputBaseSchema,
  task_batch_create: taskBatchCreateInputBaseSchema,
  task_batch_create_describe: taskBatchCreateInputBaseSchema,
  task_batch_defer_smart: taskBatchDeferSmartInputSchema,
  task_batch_delete: taskBatchDeleteInputSchema,
  task_batch_drop: taskBatchDropInputSchema,
  task_batch_move: taskBatchMoveInputSchema,
  task_batch_uncomplete: taskBatchUncompleteInputSchema,
  task_batch_undrop: taskBatchUndropInputSchema,
  // task_batch_update uses the base schema (ZodObject) — the exported schema is ZodEffects
  task_batch_update: taskBatchUpdateInputBaseSchema,
  task_batch_update_describe: taskBatchUpdateInputBaseSchema,
  task_clear_alarms: taskClearAlarmsInputSchema,
  task_clear_repetition: taskClearRepetitionInputSchema,
  task_clear_waiting_on: taskClearWaitingOnInputSchema,
  task_complete: taskCompleteInputSchema,
  task_complete_describe: taskCompleteInputSchema,
  task_convert_to_project: taskConvertToProjectInputSchema,
  task_create: taskCreateInputSchema,
  task_create_describe: taskCreateInputSchema,
  task_defer_smart: taskDeferSmartInputSchema,
  task_delete: taskDeleteInputSchema,
  task_delete_describe: taskDeleteInputSchema,
  task_drop: taskDropInputSchema,
  task_drop_describe: taskDropInputSchema,
  task_duplicate: taskDuplicateInputSchema,
  task_extract_from_image: taskExtractFromImageInputBaseSchema,
  task_extract_from_note: taskExtractFromNoteInputBaseSchema,
  task_find_by_name: taskFindByNameInputSchema,
  task_find_similar: taskFindSimilarInputSchema,
  task_get: taskGetInputSchema,
  task_get_many: taskGetManyInputSchema,
  task_list: taskListInputSchema,
  task_move: taskMoveInputSchema,
  task_move_describe: taskMoveInputSchema,
  task_parse_transport_text: taskParseTransportTextInputSchema,
  // task_reclassify uses the base schema (ZodObject) — the exported schema is ZodEffects
  task_reclassify: taskReclassifyInputBaseSchema,
  task_reorder: taskReorderInputSchema,
  task_search: z.object(taskSearchInputShape),
  task_set_alarms: taskSetAlarmsInputSchema,
  task_set_repetition: taskSetRepetitionInputSchema,
  task_set_waiting_on: taskSetWaitingOnInputSchema,
  task_uncomplete: taskUncompleteInputSchema,
  task_undrop: taskUndropInputSchema,
  // task_update uses the base schema (ZodObject) — the exported schema is ZodEffects
  task_update: taskUpdateInputBaseSchema,
  task_update_describe: taskUpdateInputBaseSchema,
  webhook_delete: webhookDeleteInputSchema,
  webhook_list: webhookListInputSchema,
  webhook_register: webhookRegisterInputSchema,
  webhook_test: webhookTestInputSchema,
  window_get_state: windowGetStateInputSchema,
  window_set_focus: windowSetFocusInputSchema,
  window_set_perspective: windowSetPerspectiveInputSchema,
};
