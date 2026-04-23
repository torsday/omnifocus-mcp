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

import type { z } from "zod";
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
import { projectDeleteInputSchema } from "./project/delete.js";
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
import { taskClearRepetitionInputSchema } from "./task/clearRepetition.js";
import { taskDeleteInputSchema } from "./task/delete.js";
import { taskFindByNameInputSchema } from "./task/findByName.js";
import { taskGetInputSchema } from "./task/get.js";
import { taskGetManyInputSchema } from "./task/getMany.js";
import { taskListInputSchema } from "./task/list.js";
import { taskSetRepetitionInputSchema } from "./task/setRepetition.js";
// task_update uses the base schema (ZodObject) — the exported schema is ZodEffects
import { taskUpdateInputBaseSchema } from "./task/update.js";

export const ALL_INPUT_SCHEMAS: Record<string, z.ZodObject<z.ZodRawShape>> = {
  folder_create: folderCreateInputSchema,
  folder_delete: folderDeleteInputSchema,
  folder_get: folderGetInputSchema,
  folder_list: folderListInputSchema,
  folder_move: folderMoveInputSchema,
  folder_update: folderUpdateInputSchema,
  note_append: noteAppendInputSchema,
  note_get: noteGetInputSchema,
  note_get_html: noteGetHtmlInputSchema,
  note_set: noteSetInputSchema,
  note_set_html: noteSetHtmlInputSchema,
  project_delete: projectDeleteInputSchema,
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
  task_delete: taskDeleteInputSchema,
  task_find_by_name: taskFindByNameInputSchema,
  task_get: taskGetInputSchema,
  task_get_many: taskGetManyInputSchema,
  task_list: taskListInputSchema,
  task_set_repetition: taskSetRepetitionInputSchema,
  task_update: taskUpdateInputBaseSchema,
};
