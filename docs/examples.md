# Example interactions

Concrete prompts and the tool-call sequences they trigger, to illustrate how an MCP-connected assistant uses `omnifocus-mcp` end-to-end. See [`docs/tools.md`](./tools.md) for the full tool reference and [`prompts.md`](./prompts.md) for the bundled MCP prompt templates.

---

**"What's in my inbox right now?"**

The assistant calls `task_list` with `{ "available": true, "limit": 20 }` and returns a formatted list of actionable inbox tasks with their IDs, due dates, and flags.

---

**"Create a task to 'review Q2 budget' due Friday, flagged, in the Finance project."**

1. Calls `project_list` to find the Finance project ID.
2. Calls `task_create` with `{ "name": "review Q2 budget", "projectId": "<id>", "dueDate": "end-of-week", "flagged": true }`.
3. Returns the created task with its persistent ID and confirms the due date resolved to the correct Friday.

---

**"Mark all my overdue tasks as deferred to tomorrow."**

1. Calls `task_list` with `{ "dueBefore": "today", "available": true }` to find overdue items.
2. Calls `task_batch_update` with `{ "deferDate": "tomorrow" }` for all of them in one atomic call.
3. Reports: *"Deferred 7 overdue tasks to tomorrow. Call sync_trigger if you want iCloud to update immediately."*

---

**"Show me what's due this week in the Work perspective."**

1. Calls `perspective_list` to find the "Work" perspective ID.
2. Calls `perspective_evaluate` with `{ "perspectiveId": "<id>" }` to get tasks in that perspective.
3. Filters and presents items with due dates within the current week.

---

**"I just finished the sprint — complete all tasks in the Mobile App project."**

1. Calls `project_get` to retrieve the project and its tasks.
2. Calls `task_batch_complete` with the full list of task IDs in one call.
3. Confirms the count and suggests calling `sync_trigger` for cross-device visibility.
