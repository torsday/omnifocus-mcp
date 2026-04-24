import { APP_LAUNCH_DESCRIPTION } from "./app/launch.js";
import {
  ATTACHMENT_ADD_DESCRIPTION,
  ATTACHMENT_LIST_DESCRIPTION,
  ATTACHMENT_REMOVE_DESCRIPTION,
  ATTACHMENT_SAVE_TO_PATH_DESCRIPTION,
} from "./attachment/index.js";
import { EXPORT_OPML_DESCRIPTION } from "./export/opml.js";
import { FOLDER_CREATE_DESCRIPTION } from "./folder/create.js";
import { FOLDER_DELETE_DESCRIPTION } from "./folder/delete.js";
import { FOLDER_GET_DESCRIPTION } from "./folder/get.js";
import { FOLDER_LIST_DESCRIPTION } from "./folder/list.js";
import { FOLDER_MOVE_DESCRIPTION } from "./folder/move.js";
import { FOLDER_UPDATE_DESCRIPTION } from "./folder/update.js";
import { FORECAST_GET_DESCRIPTION } from "./forecast/get.js";
import { NOTE_APPEND_DESCRIPTION } from "./note/append.js";
import { NOTE_GET_DESCRIPTION } from "./note/get.js";
import { NOTE_GET_HTML_DESCRIPTION } from "./note/get_html.js";
import { NOTE_SET_DESCRIPTION } from "./note/set.js";
import { NOTE_SET_HTML_DESCRIPTION } from "./note/set_html.js";
import { INTERNAL_STATUS_DESCRIPTION } from "./observability/internalStatus.js";
import { PLUGIN_INVOKE_DESCRIPTION } from "./plugin/invoke.js";
import { PROJECT_DELETE_DESCRIPTION } from "./project/delete.js";
import { SEARCH_QUERY_DESCRIPTION } from "./search/query.js";
import { SYNC_STATUS_DESCRIPTION } from "./sync/status.js";
import { SYNC_TRIGGER_DESCRIPTION } from "./sync/trigger.js";
import { TAG_CREATE_DESCRIPTION } from "./tag/create.js";
import { TAG_DELETE_DESCRIPTION } from "./tag/delete.js";
import { TAG_GET_DESCRIPTION } from "./tag/get.js";
import { TAG_GET_LOCATION_DESCRIPTION } from "./tag/getLocation.js";
import { TAG_LIST_DESCRIPTION } from "./tag/list.js";
import { TAG_MOVE_DESCRIPTION } from "./tag/move.js";
import { TAG_SET_ALLOWS_NEXT_ACTION_DESCRIPTION } from "./tag/setAllowsNextAction.js";
import { TAG_SET_LOCATION_DESCRIPTION } from "./tag/setLocation.js";
import { TAG_SET_STATUS_DESCRIPTION } from "./tag/setStatus.js";
import { TAG_UPDATE_DESCRIPTION } from "./tag/update.js";
import { TASK_CLEAR_REPETITION_DESCRIPTION } from "./task/clearRepetition.js";
import { TASK_DELETE_DESCRIPTION } from "./task/delete.js";
import { TASK_DUPLICATE_DESCRIPTION } from "./task/duplicate.js";
import { TASK_FIND_BY_NAME_DESCRIPTION } from "./task/findByName.js";
import { TASK_GET_DESCRIPTION } from "./task/get.js";
import { TASK_GET_MANY_DESCRIPTION } from "./task/getMany.js";
import { TASK_LIST_DESCRIPTION } from "./task/list.js";
import { TASK_MOVE_DESCRIPTION } from "./task/move.js";
import { TASK_PARSE_TRANSPORT_TEXT_DESCRIPTION } from "./task/parseTransportText.js";
import { TASK_REORDER_DESCRIPTION } from "./task/reorder.js";
import { TASK_SET_REPETITION_DESCRIPTION } from "./task/setRepetition.js";
import { TASK_UPDATE_DESCRIPTION } from "./task/update.js";

export const ALL_TOOL_DESCRIPTIONS: Record<string, string> = {
  app_launch: APP_LAUNCH_DESCRIPTION,
  attachment_add: ATTACHMENT_ADD_DESCRIPTION,
  attachment_list: ATTACHMENT_LIST_DESCRIPTION,
  attachment_remove: ATTACHMENT_REMOVE_DESCRIPTION,
  attachment_save_to_path: ATTACHMENT_SAVE_TO_PATH_DESCRIPTION,
  export_opml: EXPORT_OPML_DESCRIPTION,
  forecast_get: FORECAST_GET_DESCRIPTION,
  folder_create: FOLDER_CREATE_DESCRIPTION,
  folder_delete: FOLDER_DELETE_DESCRIPTION,
  folder_get: FOLDER_GET_DESCRIPTION,
  folder_list: FOLDER_LIST_DESCRIPTION,
  folder_move: FOLDER_MOVE_DESCRIPTION,
  folder_update: FOLDER_UPDATE_DESCRIPTION,
  internal_status: INTERNAL_STATUS_DESCRIPTION,
  note_append: NOTE_APPEND_DESCRIPTION,
  note_get: NOTE_GET_DESCRIPTION,
  note_get_html: NOTE_GET_HTML_DESCRIPTION,
  note_set: NOTE_SET_DESCRIPTION,
  note_set_html: NOTE_SET_HTML_DESCRIPTION,
  plugin_invoke: PLUGIN_INVOKE_DESCRIPTION,
  project_delete: PROJECT_DELETE_DESCRIPTION,
  search_query: SEARCH_QUERY_DESCRIPTION,
  sync_status: SYNC_STATUS_DESCRIPTION,
  sync_trigger: SYNC_TRIGGER_DESCRIPTION,
  tag_create: TAG_CREATE_DESCRIPTION,
  tag_delete: TAG_DELETE_DESCRIPTION,
  tag_get: TAG_GET_DESCRIPTION,
  tag_get_location: TAG_GET_LOCATION_DESCRIPTION,
  tag_list: TAG_LIST_DESCRIPTION,
  tag_move: TAG_MOVE_DESCRIPTION,
  tag_set_allows_next_action: TAG_SET_ALLOWS_NEXT_ACTION_DESCRIPTION,
  tag_set_location: TAG_SET_LOCATION_DESCRIPTION,
  tag_set_status: TAG_SET_STATUS_DESCRIPTION,
  tag_update: TAG_UPDATE_DESCRIPTION,
  task_clear_repetition: TASK_CLEAR_REPETITION_DESCRIPTION,
  task_delete: TASK_DELETE_DESCRIPTION,
  task_duplicate: TASK_DUPLICATE_DESCRIPTION,
  task_find_by_name: TASK_FIND_BY_NAME_DESCRIPTION,
  task_get: TASK_GET_DESCRIPTION,
  task_get_many: TASK_GET_MANY_DESCRIPTION,
  task_list: TASK_LIST_DESCRIPTION,
  task_move: TASK_MOVE_DESCRIPTION,
  task_parse_transport_text: TASK_PARSE_TRANSPORT_TEXT_DESCRIPTION,
  task_reorder: TASK_REORDER_DESCRIPTION,
  task_set_repetition: TASK_SET_REPETITION_DESCRIPTION,
  task_update: TASK_UPDATE_DESCRIPTION,
};
