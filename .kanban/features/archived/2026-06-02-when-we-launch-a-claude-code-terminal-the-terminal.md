---
id: "2026-06-02-when-we-launch-a-claude-code-terminal-the-terminal"
status: "done"
priority: "medium"
assignee: null
epic: null
dueDate: null
created: "2026-06-03T05:55:00.625Z"
modified: "2026-06-02T23:35:00.000Z"
completedAt: null
labels: ["terminal", "ux"]
order: "a0"
---
# When we launch a Claude Code terminal, the terminal title should be &lt;status&gt;: &lt;title&gt;

example:\
\
todo: Replace .devtool for .kanban folder

## Acceptance criteria
- [ ] Launching an agent terminal from the kanban board sets the terminal title to `<column display name>: <story title>` (e.g. `To Do: Replace .devtool for .kanban folder`)
- [ ] The column display name is the human-readable name from the kanban config (e.g. `To Do`, `In Progress`), not the raw status ID
- [ ] The feature applies to all supported agents: Claude Code, Codex, GitHub Copilot, OpenCode
- [ ] When no `terminalTitle` is provided, the terminal name falls back to the agent name (e.g. `Claude Code`)
- [ ] Existing tests continue to pass without modification
- [ ] New unit tests cover: title used when provided, fallback when omitted, fallback when `undefined`, and a non-claude agent

## Context & constraints
- Design spec: `docs/superpowers/specs/2026-06-02-terminal-title-status-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-02-terminal-title-status.md`
- Both call sites (`FeatureHeaderProvider.ts` and `KanbanPanel.ts`) already have `column.name` and the story title in scope — no data fetching needed
- The `terminalTitle` parameter is optional (fifth arg) to avoid breaking existing callers