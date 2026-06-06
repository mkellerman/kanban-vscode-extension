---
id: "backlog-mcp-sessions-domain"
status: "todo"
priority: "medium"
epic: null
order: "a4"
dependsOn: ["backlog-mcp-native-adapter"]
sessions: []
created: "2026-06-06T13:05:00.000Z"
modified: "2026-06-06T13:05:00.000Z"
completedAt: null
---
# Backlog MCP: sessions domain

Tail-parse ~/.claude/projects JSONL → normalized Sessions (last activity, needs-input, model, tokens); claudine-optional.

## Acceptance criteria
- [ ] list_sessions / get_session over real JSONL
- [ ] link sessions to work items (branch/worktree + launch capture)
- [ ] claudine enrichment when installed (no hard dep)
