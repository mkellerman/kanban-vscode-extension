---
id: "backlog-mcp-native-adapter"
status: "done"
priority: "high"
epic: null
order: "a1"
dependsOn: ["backlog-mcp-scaffold"]
sessions: []
created: "2026-06-06T12:15:00.000Z"
modified: "2026-06-06T12:40:00.000Z"
completedAt: "2026-06-06T12:40:00.000Z"
---
# Backlog MCP: real native adapter

Read/write the per-story-folder format behind an adapter Registry; the MCP serves real boards (not fixtures).

## Acceptance criteria
- [x] native adapter parses story.md → namespaced WorkItems
- [x] registry detects + aggregates
- [x] library + server read real boards
