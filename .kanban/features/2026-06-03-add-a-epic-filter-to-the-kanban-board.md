---
id: "2026-06-03-add-a-epic-filter-to-the-kanban-board"
status: "done"
priority: "medium"
assignee: null
epic: null
dueDate: null
created: "2026-06-03T16:33:02.311Z"
modified: "2026-06-03T20:22:00.000Z"
completedAt: "2026-06-03T20:22:00.000Z"
labels: ["filter", "webview"]
order: "a4V"
worktree: "/Users/me/Documents/GitHub/kanban-vscode-extension/.claude/worktrees/story+2026-06-03-add-a-epic-filter-to-the-kanban-board"
---
# Add an epic filter to the Kanban Board

Like the label/assignee/priority filters, add one for Epic.

## Acceptance criteria
- [ ] A dropdown appears in the Toolbar between the label filter and the due-date filter when `cardSettings.showEpic` is true
- [ ] The dropdown is hidden when `cardSettings.showEpic` is false
- [ ] The dropdown contains an "All Epics" default option, a "No Epic" option, and one option per unique epic name from the board
- [ ] Selecting a named epic hides all cards on the board whose epic does not match
- [ ] Selecting "No Epic" shows only cards with no epic assigned
- [ ] The filter is cleared by the existing "Clear" button (via `clearAllFilters`)
- [ ] `hasActiveFilters` returns true when the epic filter is not "All Epics"
- [ ] In epic board view mode, selecting a named epic hides all swim lanes except the matching one
- [ ] Selecting "No Epic" in epic board view mode hides all named-epic swim lanes and shows only the "No Epic" lane
- [ ] All new i18n keys are present in en, es, and pt locale files

## Context & constraints
- Design spec: `docs/superpowers/specs/2026-06-03-epic-filter-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-03-add-a-epic-filter-to-the-kanban-board.md`
- `getUniqueEpics()` already exists in the store — no new query needed
- `KanbanBoardProps.epicFilter` (swim-lane prop) is unchanged — the new `epicFilter` is store state
- The sentinel `'no-epic'` is used for "no epic" (mirrors `'unassigned'` and `'unlabeled'` patterns)
- Filter visible in both standard and epic board view modes