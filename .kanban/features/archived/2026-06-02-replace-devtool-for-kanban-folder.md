---
id: "2026-06-02-replace-devtool-for-kanban-folder"
status: "done"
priority: "high"
assignee: null
epic: null
dueDate: null
created: "2026-06-03T05:49:31.274Z"
modified: "2026-06-03T07:18:00.000Z"
completedAt: "2026-06-03T07:18:00.000Z"
labels: ["config", "rename"]
order: "a2"
---
# Replace .devtool for .kanban folder

As a user of the kanban extension, I want the default features directory to be `.kanban/features` instead of `.devtool/features`, so that the folder name is self-describing and clearly associated with the extension.

## Acceptance criteria
- [x] `kanban-extension.featuresDirectory` config default is `.kanban/features` in `package.json`
- [x] All 4 source fallback strings (`KanbanPanel.ts`, `FeatureHeaderProvider.ts`, `SidebarViewProvider.ts`, `index.ts`) use `.kanban/features`
- [x] `README.md` configuration table reflects `.kanban/features` as the default
- [x] All test files use `.kanban/features` in hardcoded path strings
- [x] This repo's `.devtool/features/` directory is renamed to `.kanban/features/` via `git mv`
- [x] All existing tests pass after the changes
- [x] No migration logic introduced — users with existing `.devtool/features` data configure `featuresDirectory` manually

## Context & constraints
- Design spec: `docs/superpowers/specs/2026-06-02-replace-devtool-kanban-folder-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-02-replace-devtool-kanban-folder.md`
- Config key name (`kanban-extension.featuresDirectory`) is NOT renamed — it remains accurate
- `.devtool/plans/` is NOT moved — it belongs to the AI dev workflow, not the extension
- No auto-migration: this is a default-only change with no backward-compat fallback