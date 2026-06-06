# Backlog MCP usage (server name: `backlog`)

| Intent | MCP calls |
|---|---|
| what's next | `dependency_graph` (readySet + blocked) + `list_work_items` → rank (references/ranking.md) |
| what's needed before `<X>` | `list_work_items` → walk `dependsOn` backward from X; show the chain + the bottleneck (deepest not-done) |
| add `<feature>` | create a native story folder `.kanban/features/<id>/story.md` (check id collision via `get_work_item`), then brainstorm the spec |
| board health | `detect_frameworks` + `dependency_graph().cycles` + stale items |
| live activity for a story | `list_sessions` (the story's linked sessions) |

The MCP serves both **work items** (any framework, via adapters) and **sessions**
(real `~/.claude/projects` JSONL). The PA is a pure consumer — never read those files directly.
