import { APP_LAUNCH_DESCRIPTION } from "./app/launch.js";
import {
  ATTACHMENT_ADD_DESCRIPTION,
  ATTACHMENT_LIST_DESCRIPTION,
  ATTACHMENT_REMOVE_DESCRIPTION,
  ATTACHMENT_SAVE_TO_PATH_DESCRIPTION,
} from "./attachment/index.js";
import { DATABASE_REDO_DESCRIPTION } from "./database/redo.js";
import { DATABASE_UNDO_DESCRIPTION } from "./database/undo.js";
import { EXPORT_OPML_DESCRIPTION } from "./export/opml.js";
import { IMPORT_OPML_DESCRIPTION } from "./export/opml_import.js";
import { EXPORT_TASKPAPER_DESCRIPTION, IMPORT_TASKPAPER_DESCRIPTION } from "./export/taskpaper.js";
import { FOLDER_CREATE_DESCRIPTION } from "./folder/create.js";
import { FOLDER_CREATE_DESCRIBE_DESCRIPTION } from "./folder/createDescribe.js";
import { FOLDER_DELETE_DESCRIPTION } from "./folder/delete.js";
import { FOLDER_DELETE_DESCRIBE_DESCRIPTION } from "./folder/deleteDescribe.js";
import { FOLDER_GET_DESCRIPTION } from "./folder/get.js";
import { FOLDER_LIST_DESCRIPTION } from "./folder/list.js";
import { FOLDER_MOVE_DESCRIPTION } from "./folder/move.js";
import { FOLDER_MOVE_DESCRIBE_DESCRIPTION } from "./folder/moveDescribe.js";
import { FOLDER_UPDATE_DESCRIPTION } from "./folder/update.js";
import { FOLDER_UPDATE_DESCRIBE_DESCRIPTION } from "./folder/updateDescribe.js";
import { FORECAST_GET_DESCRIPTION } from "./forecast/get.js";
import { FORECAST_GET_TAG_DESCRIPTION } from "./forecast/get_tag.js";
import { FORECAST_PACK_DESCRIPTION } from "./forecast/pack.js";
import { FORECAST_SET_TAG_DESCRIPTION } from "./forecast/set_tag.js";
import { NOTE_APPEND_DESCRIPTION } from "./note/append.js";
import { NOTE_GET_DESCRIPTION } from "./note/get.js";
import { NOTE_GET_HTML_DESCRIPTION } from "./note/get_html.js";
import { NOTE_SET_DESCRIPTION } from "./note/set.js";
import { NOTE_SET_HTML_DESCRIPTION } from "./note/set_html.js";
import { INTERNAL_STATUS_DESCRIPTION } from "./observability/internalStatus.js";
import { PERSPECTIVE_CREATE_DESCRIPTION } from "./perspective/create.js";
import { PERSPECTIVE_DELETE_DESCRIPTION } from "./perspective/delete.js";
import { PERSPECTIVE_EVALUATE_DESCRIPTION } from "./perspective/evaluate.js";
import { PERSPECTIVE_GET_DESCRIPTION } from "./perspective/get.js";
import { PERSPECTIVE_LIST_DESCRIPTION } from "./perspective/list.js";
import { PERSPECTIVE_UPDATE_DESCRIPTION } from "./perspective/update.js";
import { PLUGIN_INVOKE_DESCRIPTION } from "./plugin/invoke.js";
import { PROJECT_BATCH_COMPLETE_DESCRIPTION } from "./project/batchComplete.js";
import { PROJECT_BATCH_DROP_DESCRIPTION } from "./project/batchDrop.js";
import { PROJECT_COMPLETE_DESCRIPTION } from "./project/complete.js";
import { PROJECT_COMPLETE_DESCRIBE_DESCRIPTION } from "./project/completeDescribe.js";
import { PROJECT_CREATE_DESCRIPTION } from "./project/create.js";
import { PROJECT_CREATE_DESCRIBE_DESCRIPTION } from "./project/createDescribe.js";
import { PROJECT_DELETE_DESCRIPTION } from "./project/delete.js";
import { PROJECT_DELETE_DESCRIBE_DESCRIPTION } from "./project/deleteDescribe.js";
import { PROJECT_DROP_DESCRIPTION } from "./project/drop.js";
import { PROJECT_DROP_DESCRIBE_DESCRIPTION } from "./project/dropDescribe.js";
import { PROJECT_GET_DESCRIPTION } from "./project/get.js";
import { PROJECT_GET_MANY_DESCRIPTION } from "./project/getMany.js";
import { PROJECT_LIST_DESCRIPTION } from "./project/list.js";
import { PROJECT_MOVE_DESCRIPTION } from "./project/move.js";
import { PROJECT_MOVE_DESCRIBE_DESCRIPTION } from "./project/moveDescribe.js";
import { PROJECT_TEMPLATE_INSTANTIATE_DESCRIPTION } from "./project/templateInstantiate.js";
import { PROJECT_TEMPLATE_LIST_DESCRIPTION } from "./project/templateList.js";
import { PROJECT_TEMPLATE_SAVE_DESCRIPTION } from "./project/templateSave.js";
import { PROJECT_UPDATE_DESCRIPTION } from "./project/update.js";
import { PROJECT_UPDATE_DESCRIBE_DESCRIPTION } from "./project/updateDescribe.js";
import { RUN_JXA_SCRIPT_DESCRIPTION } from "./rawScript/jxa.js";
import { RUN_OMNIJS_SCRIPT_DESCRIPTION } from "./rawScript/omnijs.js";
import { REPETITION_FROM_PROSE_DESCRIPTION } from "./repetition/fromProse.js";
import { REVIEW_LIST_DUE_DESCRIPTION } from "./review/listDue.js";
import { REVIEW_MARK_REVIEWED_DESCRIPTION } from "./review/markReviewed.js";
import { PROJECT_MARK_REVIEWED_DESCRIPTION } from "./review/projectMarkReviewed.js";
import { REVIEW_SET_INTERVAL_DESCRIPTION } from "./review/setInterval.js";
import { PROJECT_SET_NEXT_REVIEW_DATE_DESCRIPTION } from "./review/setNextReviewDate.js";
import { SEARCH_QUERY_DESCRIPTION } from "./search/query.js";
import { SYNC_STATUS_DESCRIPTION } from "./sync/status.js";
import { SYNC_TRIGGER_DESCRIPTION } from "./sync/trigger.js";
import { TAG_CREATE_DESCRIPTION } from "./tag/create.js";
import { TAG_CREATE_DESCRIBE_DESCRIPTION } from "./tag/createDescribe.js";
import { TAG_DELETE_DESCRIPTION } from "./tag/delete.js";
import { TAG_DELETE_DESCRIBE_DESCRIPTION } from "./tag/deleteDescribe.js";
import { TAG_GET_DESCRIPTION } from "./tag/get.js";
import { TAG_GET_LOCATION_DESCRIPTION } from "./tag/getLocation.js";
import { TAG_GET_MANY_DESCRIPTION } from "./tag/getMany.js";
import { TAG_LIST_DESCRIPTION } from "./tag/list.js";
import { TAG_MOVE_DESCRIPTION } from "./tag/move.js";
import { TAG_MOVE_DESCRIBE_DESCRIPTION } from "./tag/moveDescribe.js";
import { TAG_SET_ALLOWS_NEXT_ACTION_DESCRIPTION } from "./tag/setAllowsNextAction.js";
import { TAG_SET_LOCATION_DESCRIPTION } from "./tag/setLocation.js";
import { TAG_SET_STATUS_DESCRIPTION } from "./tag/setStatus.js";
import { TAG_UPDATE_DESCRIPTION } from "./tag/update.js";
import { TAG_UPDATE_DESCRIBE_DESCRIPTION } from "./tag/updateDescribe.js";
import { TASK_BATCH_ASSIGN_DESCRIPTION } from "./task/batchAssign.js";
import { TASK_BATCH_COMPLETE_DESCRIPTION } from "./task/batchComplete.js";
import { TASK_BATCH_CREATE_DESCRIPTION } from "./task/batchCreate.js";
import { TASK_BATCH_CREATE_DESCRIBE_DESCRIPTION } from "./task/batchCreateDescribe.js";
import { TASK_BATCH_DELETE_DESCRIPTION } from "./task/batchDelete.js";
import { TASK_BATCH_DROP_DESCRIPTION } from "./task/batchDrop.js";
import { TASK_BATCH_MOVE_DESCRIPTION } from "./task/batchMove.js";
import { TASK_BATCH_UNCOMPLETE_DESCRIPTION } from "./task/batchUncomplete.js";
import { TASK_BATCH_UNDROP_DESCRIPTION } from "./task/batchUndrop.js";
import { TASK_BATCH_UPDATE_DESCRIPTION } from "./task/batchUpdate.js";
import { TASK_BATCH_UPDATE_DESCRIBE_DESCRIPTION } from "./task/batchUpdateDescribe.js";
import { TASK_CLEAR_ALARMS_DESCRIPTION } from "./task/clearAlarms.js";
import { TASK_CLEAR_REPETITION_DESCRIPTION } from "./task/clearRepetition.js";
import { TASK_COMPLETE_DESCRIPTION } from "./task/complete.js";
import { TASK_COMPLETE_DESCRIBE_DESCRIPTION } from "./task/completeDescribe.js";
import { TASK_CONVERT_TO_PROJECT_DESCRIPTION } from "./task/convertToProject.js";
import { TASK_CREATE_DESCRIPTION } from "./task/create.js";
import { TASK_CREATE_DESCRIBE_DESCRIPTION } from "./task/createDescribe.js";
import { TASK_DELETE_DESCRIPTION } from "./task/delete.js";
import { TASK_DELETE_DESCRIBE_DESCRIPTION } from "./task/deleteDescribe.js";
import { TASK_DROP_DESCRIPTION } from "./task/drop.js";
import { TASK_DROP_DESCRIBE_DESCRIPTION } from "./task/dropDescribe.js";
import { TASK_DUPLICATE_DESCRIPTION } from "./task/duplicate.js";
import { TASK_EXTRACT_FROM_IMAGE_DESCRIPTION } from "./task/extractFromImage.js";
import { TASK_EXTRACT_FROM_NOTE_DESCRIPTION } from "./task/extractFromNote.js";
import { TASK_FIND_BY_NAME_DESCRIPTION } from "./task/findByName.js";
import { TASK_FIND_SIMILAR_DESCRIPTION } from "./task/findSimilar.js";
import { TASK_GET_DESCRIPTION } from "./task/get.js";
import { TASK_GET_MANY_DESCRIPTION } from "./task/getMany.js";
import { TASK_LIST_DESCRIPTION } from "./task/list.js";
import { TASK_MOVE_DESCRIPTION } from "./task/move.js";
import { TASK_MOVE_DESCRIBE_DESCRIPTION } from "./task/moveDescribe.js";
import { TASK_PARSE_TRANSPORT_TEXT_DESCRIPTION } from "./task/parseTransportText.js";
import { TASK_RECLASSIFY_DESCRIPTION } from "./task/reclassify.js";
import { TASK_REORDER_DESCRIPTION } from "./task/reorder.js";
import { TASK_SEARCH_DESCRIPTION } from "./task/search.js";
import { TASK_SET_ALARMS_DESCRIPTION } from "./task/setAlarms.js";
import { TASK_SET_REPETITION_DESCRIPTION } from "./task/setRepetition.js";
import { TASK_UNCOMPLETE_DESCRIPTION } from "./task/uncomplete.js";
import { TASK_UNDROP_DESCRIPTION } from "./task/undrop.js";
import { TASK_UPDATE_DESCRIPTION } from "./task/update.js";
import { TASK_UPDATE_DESCRIBE_DESCRIPTION } from "./task/updateDescribe.js";
import {
  TASK_CLEAR_WAITING_ON_DESCRIPTION,
  TASK_SET_WAITING_ON_DESCRIPTION,
} from "./task/waitingOn.js";
import {
  APP_WINDOW_NEW_DESCRIPTION,
  APP_WINDOW_NEW_TAB_DESCRIPTION,
  WINDOW_GET_STATE_DESCRIPTION,
  WINDOW_SET_FOCUS_DESCRIPTION,
  WINDOW_SET_PERSPECTIVE_DESCRIPTION,
} from "./window/index.js";

export const ALL_TOOL_DESCRIPTIONS: Record<string, string> = {
  app_launch: APP_LAUNCH_DESCRIPTION,
  attachment_add: ATTACHMENT_ADD_DESCRIPTION,
  attachment_list: ATTACHMENT_LIST_DESCRIPTION,
  attachment_remove: ATTACHMENT_REMOVE_DESCRIPTION,
  attachment_save_to_path: ATTACHMENT_SAVE_TO_PATH_DESCRIPTION,
  database_redo: DATABASE_REDO_DESCRIPTION,
  database_undo: DATABASE_UNDO_DESCRIPTION,
  export_opml: EXPORT_OPML_DESCRIPTION,
  export_taskpaper: EXPORT_TASKPAPER_DESCRIPTION,
  forecast_get: FORECAST_GET_DESCRIPTION,
  forecast_get_tag: FORECAST_GET_TAG_DESCRIPTION,
  forecast_pack: FORECAST_PACK_DESCRIPTION,
  forecast_set_tag: FORECAST_SET_TAG_DESCRIPTION,
  folder_create: FOLDER_CREATE_DESCRIPTION,
  folder_create_describe: FOLDER_CREATE_DESCRIBE_DESCRIPTION,
  folder_delete: FOLDER_DELETE_DESCRIPTION,
  folder_delete_describe: FOLDER_DELETE_DESCRIBE_DESCRIPTION,
  folder_get: FOLDER_GET_DESCRIPTION,
  folder_list: FOLDER_LIST_DESCRIPTION,
  folder_move: FOLDER_MOVE_DESCRIPTION,
  folder_move_describe: FOLDER_MOVE_DESCRIBE_DESCRIPTION,
  folder_update: FOLDER_UPDATE_DESCRIPTION,
  folder_update_describe: FOLDER_UPDATE_DESCRIBE_DESCRIPTION,
  import_opml: IMPORT_OPML_DESCRIPTION,
  import_taskpaper: IMPORT_TASKPAPER_DESCRIPTION,
  internal_status: INTERNAL_STATUS_DESCRIPTION,
  note_append: NOTE_APPEND_DESCRIPTION,
  note_get: NOTE_GET_DESCRIPTION,
  note_get_html: NOTE_GET_HTML_DESCRIPTION,
  note_set: NOTE_SET_DESCRIPTION,
  note_set_html: NOTE_SET_HTML_DESCRIPTION,
  perspective_create: PERSPECTIVE_CREATE_DESCRIPTION,
  perspective_delete: PERSPECTIVE_DELETE_DESCRIPTION,
  perspective_evaluate: PERSPECTIVE_EVALUATE_DESCRIPTION,
  perspective_get: PERSPECTIVE_GET_DESCRIPTION,
  perspective_list: PERSPECTIVE_LIST_DESCRIPTION,
  perspective_update: PERSPECTIVE_UPDATE_DESCRIPTION,
  plugin_invoke: PLUGIN_INVOKE_DESCRIPTION,
  project_batch_complete: PROJECT_BATCH_COMPLETE_DESCRIPTION,
  project_batch_drop: PROJECT_BATCH_DROP_DESCRIPTION,
  project_complete: PROJECT_COMPLETE_DESCRIPTION,
  project_complete_describe: PROJECT_COMPLETE_DESCRIBE_DESCRIPTION,
  project_create: PROJECT_CREATE_DESCRIPTION,
  project_create_describe: PROJECT_CREATE_DESCRIBE_DESCRIPTION,
  project_delete: PROJECT_DELETE_DESCRIPTION,
  project_delete_describe: PROJECT_DELETE_DESCRIBE_DESCRIPTION,
  project_drop: PROJECT_DROP_DESCRIPTION,
  project_drop_describe: PROJECT_DROP_DESCRIBE_DESCRIPTION,
  project_get: PROJECT_GET_DESCRIPTION,
  project_get_many: PROJECT_GET_MANY_DESCRIPTION,
  project_list: PROJECT_LIST_DESCRIPTION,
  project_mark_reviewed: PROJECT_MARK_REVIEWED_DESCRIPTION,
  project_move: PROJECT_MOVE_DESCRIPTION,
  project_move_describe: PROJECT_MOVE_DESCRIBE_DESCRIPTION,
  project_template_instantiate: PROJECT_TEMPLATE_INSTANTIATE_DESCRIPTION,
  project_template_list: PROJECT_TEMPLATE_LIST_DESCRIPTION,
  project_template_save: PROJECT_TEMPLATE_SAVE_DESCRIPTION,
  project_update: PROJECT_UPDATE_DESCRIPTION,
  repetition_from_prose: REPETITION_FROM_PROSE_DESCRIPTION,
  project_update_describe: PROJECT_UPDATE_DESCRIBE_DESCRIPTION,
  review_list_due: REVIEW_LIST_DUE_DESCRIPTION,
  review_mark_reviewed: REVIEW_MARK_REVIEWED_DESCRIPTION,
  project_set_next_review_date: PROJECT_SET_NEXT_REVIEW_DATE_DESCRIPTION,
  review_set_interval: REVIEW_SET_INTERVAL_DESCRIPTION,
  run_jxa_script: RUN_JXA_SCRIPT_DESCRIPTION,
  run_omnijs_script: RUN_OMNIJS_SCRIPT_DESCRIPTION,
  search_query: SEARCH_QUERY_DESCRIPTION,
  sync_status: SYNC_STATUS_DESCRIPTION,
  sync_trigger: SYNC_TRIGGER_DESCRIPTION,
  tag_create: TAG_CREATE_DESCRIPTION,
  tag_create_describe: TAG_CREATE_DESCRIBE_DESCRIPTION,
  tag_delete: TAG_DELETE_DESCRIPTION,
  tag_delete_describe: TAG_DELETE_DESCRIBE_DESCRIPTION,
  tag_get: TAG_GET_DESCRIPTION,
  tag_get_many: TAG_GET_MANY_DESCRIPTION,
  tag_get_location: TAG_GET_LOCATION_DESCRIPTION,
  tag_list: TAG_LIST_DESCRIPTION,
  tag_move: TAG_MOVE_DESCRIPTION,
  tag_move_describe: TAG_MOVE_DESCRIBE_DESCRIPTION,
  tag_set_allows_next_action: TAG_SET_ALLOWS_NEXT_ACTION_DESCRIPTION,
  tag_set_location: TAG_SET_LOCATION_DESCRIPTION,
  tag_set_status: TAG_SET_STATUS_DESCRIPTION,
  tag_update: TAG_UPDATE_DESCRIPTION,
  task_batch_assign: TASK_BATCH_ASSIGN_DESCRIPTION,
  tag_update_describe: TAG_UPDATE_DESCRIBE_DESCRIPTION,
  task_batch_complete: TASK_BATCH_COMPLETE_DESCRIPTION,
  task_batch_create: TASK_BATCH_CREATE_DESCRIPTION,
  task_batch_create_describe: TASK_BATCH_CREATE_DESCRIBE_DESCRIPTION,
  task_batch_delete: TASK_BATCH_DELETE_DESCRIPTION,
  task_batch_drop: TASK_BATCH_DROP_DESCRIPTION,
  task_batch_move: TASK_BATCH_MOVE_DESCRIPTION,
  task_batch_uncomplete: TASK_BATCH_UNCOMPLETE_DESCRIPTION,
  task_batch_undrop: TASK_BATCH_UNDROP_DESCRIPTION,
  task_batch_update: TASK_BATCH_UPDATE_DESCRIPTION,
  task_batch_update_describe: TASK_BATCH_UPDATE_DESCRIBE_DESCRIPTION,
  task_complete: TASK_COMPLETE_DESCRIPTION,
  task_complete_describe: TASK_COMPLETE_DESCRIBE_DESCRIPTION,
  task_create: TASK_CREATE_DESCRIPTION,
  task_create_describe: TASK_CREATE_DESCRIBE_DESCRIPTION,
  task_drop: TASK_DROP_DESCRIPTION,
  task_drop_describe: TASK_DROP_DESCRIBE_DESCRIPTION,
  task_clear_alarms: TASK_CLEAR_ALARMS_DESCRIPTION,
  task_clear_repetition: TASK_CLEAR_REPETITION_DESCRIPTION,
  task_delete: TASK_DELETE_DESCRIPTION,
  task_delete_describe: TASK_DELETE_DESCRIBE_DESCRIPTION,
  task_duplicate: TASK_DUPLICATE_DESCRIPTION,
  task_extract_from_image: TASK_EXTRACT_FROM_IMAGE_DESCRIPTION,
  task_extract_from_note: TASK_EXTRACT_FROM_NOTE_DESCRIPTION,
  task_find_by_name: TASK_FIND_BY_NAME_DESCRIPTION,
  task_find_similar: TASK_FIND_SIMILAR_DESCRIPTION,
  task_get: TASK_GET_DESCRIPTION,
  task_get_many: TASK_GET_MANY_DESCRIPTION,
  task_list: TASK_LIST_DESCRIPTION,
  task_convert_to_project: TASK_CONVERT_TO_PROJECT_DESCRIPTION,
  task_move: TASK_MOVE_DESCRIPTION,
  task_move_describe: TASK_MOVE_DESCRIBE_DESCRIPTION,
  task_search: TASK_SEARCH_DESCRIPTION,
  task_parse_transport_text: TASK_PARSE_TRANSPORT_TEXT_DESCRIPTION,
  task_reclassify: TASK_RECLASSIFY_DESCRIPTION,
  task_reorder: TASK_REORDER_DESCRIPTION,
  task_clear_waiting_on: TASK_CLEAR_WAITING_ON_DESCRIPTION,
  task_set_alarms: TASK_SET_ALARMS_DESCRIPTION,
  task_set_repetition: TASK_SET_REPETITION_DESCRIPTION,
  task_set_waiting_on: TASK_SET_WAITING_ON_DESCRIPTION,
  task_uncomplete: TASK_UNCOMPLETE_DESCRIPTION,
  task_undrop: TASK_UNDROP_DESCRIPTION,
  task_update: TASK_UPDATE_DESCRIPTION,
  app_window_new: APP_WINDOW_NEW_DESCRIPTION,
  app_window_new_tab: APP_WINDOW_NEW_TAB_DESCRIPTION,
  window_get_state: WINDOW_GET_STATE_DESCRIPTION,
  window_set_focus: WINDOW_SET_FOCUS_DESCRIPTION,
  window_set_perspective: WINDOW_SET_PERSPECTIVE_DESCRIPTION,
  task_update_describe: TASK_UPDATE_DESCRIBE_DESCRIPTION,
};
