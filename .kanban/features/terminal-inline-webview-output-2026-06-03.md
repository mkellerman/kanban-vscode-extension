---
id: "terminal-inline-webview-output-2026-06-03"
status: "review"
priority: "low"
assignee: null
epic: "Developer experience"
dueDate: null
created: "2026-06-03T22:13:29.854Z"
modified: "2026-06-04T05:37:00.000Z"
completedAt: null
labels: ["webview", "agent"]
order: "a1"
worktree: "/Users/me/GitHub/kanban-vscode-extension/.claude/worktrees/story+terminal-inline-webview-output-2026-06-03"
---
# terminal + inline webview output

When an agent terminal is launched for a card, that card shows a live "Agent running" indicator (green left accent bar + tint + pulsing label) in the webview. The indicator disappears immediately when the terminal closes. Multiple cards can have active agents simultaneously.

## Acceptance criteria
- [ ] When `AgentLauncher.launch()` is called, the corresponding card immediately shows the Option-C indicator (green left border, green tint, pulsing "Agent running" label)
- [ ] When `AgentLauncher.launchLane()` is called, all cards in the lane batch show the indicator simultaneously
- [ ] When the agent terminal closes (via `vscode.window.onDidCloseTerminal`), all associated card indicators disappear immediately with no trace
- [ ] Multiple agent terminals can be active at the same time across different cards — each card correctly reflects its own terminal's state
- [ ] If the webview panel is closed and reopened while a terminal is running, the indicator is shown on the correct cards on first render (replay on `ready`)
- [ ] The indicator is purely in-memory — no disk writes, no frontmatter changes, nothing persisted across VS Code restarts
- [ ] Existing tests for `AgentLauncher`, `KanbanPanel`, `FeatureCard` continue to pass

## Context & constraints
- Design spec: `docs/superpowers/specs/2026-06-03-terminal-inline-webview-output-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-03-terminal-inline-webview-output.md`
- No terminal output is captured or relayed — the terminal is the authoritative live view
- VS Code color variable used: `--vscode-testing-iconPassed` (theme-aware green)
- `launchAgentTerminal` return type changes from `void` to `vscode.Terminal` (Task 1)
- The `Map<Terminal, string[]>` in `AgentLauncher` handles the 1-terminal → many-features case for lane actions
