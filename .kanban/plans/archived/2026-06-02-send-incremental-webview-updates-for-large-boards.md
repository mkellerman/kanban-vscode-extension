---
id: "2026-06-02-send-incremental-webview-updates-for-large-boards"
status: "done"
priority: "low"
assignee: null
epic: "Architecture remediation"
dueDate: null
created: "2026-06-02T18:00:00.000Z"
modified: "2026-06-03T08:13:31.000Z"
completedAt: "2026-06-03T07:23:00.000Z"
labels: ["performance"]
order: "a2"
workspace: "/Users/me/Documents/GitHub/kanban-vscode-extension/.claude/worktree\
  s/story+incremental-webview-updates-2026-06-02"
---
# Send incremental webview updates for large boards

Every mutation re-sends the entire feature list to the webview, which then re-derives the filtered and sorted views. This is fine for small boards but wasteful at hundreds to thousands of cards.

## Context

`_sendFeaturesToWebview()` ships the whole list on each change, including per-keystroke auto-saves, and the webview re-sorts everything. The move path already rewrites only the changed file on disk, but the webview message is still the full list. This is a scalability improvement, not an urgent fix.

## Acceptance criteria

- [ ] Single-feature changes send only the changed feature to the webview, not the full list.
- [ ] The Zustand store applies incremental updates and memoises the filtered / sorted selectors.
- [ ] Full-list sync remains available for initial load and external refreshes.
- [ ] No regression in board correctness; verified with a large fixture (1,000+ cards).

## Affected files

- `src/extension/KanbanPanel.ts`
- `src/webview/store/index.ts`
- `src/webview/App.tsx`

## Notes

Defer until large boards are a real use case. This is last in the remediation sequence.