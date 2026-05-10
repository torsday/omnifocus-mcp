<!-- Originally DESIGN.md §26 (split per #805) -->

# Example tool — reference implementation for `task_list`

Sets the pattern every other tool follows. Concrete shapes for schema, handler, service, adapter call, and response envelope.

## Schema (zod)

```typescript
// src/tools/task/list.schema.ts
export const taskListInput = z.object({
  projectId: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
  flagged: z.boolean().optional(),
  available: z.boolean().optional().default(false),
  completed: z.enum(["any", "only", "exclude"]).optional().default("exclude"),
  dueBefore: isoDateString().optional(),
  dueAfter: isoDateString().optional(),
  deferredBefore: isoDateString().optional(),
  parentId: z.string().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  cursor: z.string().optional(),
});

export const taskListOutput = z.object({
  tasks: z.array(taskSchema),
});
```

## Handler (< 30 LOC per maintainability target in [testing-and-ci.md](./testing-and-ci.md))

```typescript
// src/tools/task/list.ts
export const taskListTool = defineTool({
  name: "task_list",
  description:
    "List tasks in OmniFocus with optional filters. " +
    "Use this for queries across tasks. " +
    "Do NOT use for a known single task (use `task_get`). " +
    "Returns tasks[] with pagination; safe to call repeatedly; no side effects.",
  inputSchema: taskListInput,
  async handler(input, ctx) {
    const tasks = await ctx.services.tasks.list(input);
    return { data: { tasks } };
  },
});
```

## Service

```typescript
// src/services/taskService.ts
export class TaskService {
  async list(filter: TaskFilter): Promise<Task[]> {
    return this.cache.wrap(["task_list", filter], () =>
      this.adapter.listTasks(filter)
    );
  }
}
```

## Adapter call (JXA transport)

```typescript
// src/adapter/jxa/JxaTransport.ts
async listTasks(filter: TaskFilter): Promise<Task[]> {
  const raw = await this.runScript("task_list.js", filter);
  return raw.map(taskFromWire);
}
```

## Script (abbreviated)

```javascript
// src/scripts/jxa/task_list.js
(function () {
  const args = JSON.parse($params);
  const OF = Application("OmniFocus");
  // …filter application per args…
  return JSON.stringify(tasks.map(serializeTask));
})();
```

Every other tool follows this pattern exactly. Deviation is a code-review red flag.
