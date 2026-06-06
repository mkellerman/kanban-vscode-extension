# "What's next" ranking (PA-opinionated)

Source the **ready set** objectively from the MCP: `dependency_graph().readySet`
(ids whose deps are all done, status backlog/todo). Fetch their `WorkItem`s via
`list_work_items`. Rank by, in order:

1. **priority** — critical > high > medium > low (null = medium)
2. **unblock-impact** — how many items list this one in `dependsOn` (more = earlier)
3. **(later) age, then `order`** — not yet available (the WorkItem contract doesn't
   expose `created`/`order`; add them to enable these tie-breakers)

Reference implementation: `@kanban/product-architect` → `rankReady()` (tested).
Present the ranked READY list with a one-line reason each, then the BLOCKED list
(`dependency_graph().blocked`) naming each item's `waitingOn`. Never invent items —
quote the MCP.
