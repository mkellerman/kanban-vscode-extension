---
id: "backlog-mcp-scaffold"
status: "done"
priority: "high"
epic: null
order: "a0"
dependsOn: []
sessions: []
created: "2026-06-06T12:00:00.000Z"
modified: "2026-06-06T12:10:00.000Z"
completedAt: "2026-06-06T12:10:00.000Z"
---
# Backlog MCP: scaffold + frozen contract + stub server

pnpm workspace + `packages/backlog-mcp`: the WorkItem/Session/DependencyGraph contract, fixtures, library stub, and a stdio MCP server.

## Acceptance criteria
- [x] contract frozen in src/contract.ts
- [x] stub MCP server advertises the tools
- [x] tests + typecheck green
