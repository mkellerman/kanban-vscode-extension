---
id: kanban-board-data-layer
status: review
priority: high
epic: null
order: "0"
dependsOn:
  - backlog-mcp-native-adapter
sessions: []
created: 2026-06-06T12:45:00.000Z
modified: 2026-06-07T14:50:00.000Z
completedAt: null
labels: []
assignee: null
dueDate: null
---
# Kanban Board: MCP data layer

Render WorkItems from `@kanban/backlog-mcp` in the board (behind the `dataSource` flag).

## Acceptance criteria

- [x] WorkItem → Feature mapping + loader (tested)
- [x] KanbanPanel wiring (build-verified)
- [x] board renders the items (/visual-walkthrough — see `.kanban/walkthroughs/kanban-board-mcp-data-layer/index.html`)
