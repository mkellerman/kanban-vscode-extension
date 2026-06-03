---
id: "surface-file-operation-errors"
status: "done"
priority: "medium"
assignee: null
epic: "Reliability"
dueDate: null
created: "2026-06-02T19:23:22.735Z"
modified: "2026-06-03T06:50:00.000Z"
completedAt: null
labels: ["error-handling", "ux", "filesystem"]
order: "a0"
---
# Surface file operation errors

## User story
As a user, I want failed file moves, writes, and deletes to be clearly surfaced so I can trust board state and recover safely.

## Scope
- Replace silent catches in save, move, and archive paths with explicit user-visible errors and contextual logging.
- Keep partial-success behavior where appropriate, but report failed items and reconciliation guidance.
- Add tests around failure branches where feasible.

## Acceptance criteria
- [ ] Any failed `writeFile` in `_createFeature`, `_moveFeature`, `_updateFeature`, or `_saveFeatureContent` shows an error message and reloads the board from disk
- [ ] Any failed `writeFile` in `_moveAllCards`, `_renameLabel`, or `_deleteLabel` reports a failure count via warning message and reloads the board from disk
- [ ] The `_loadFeatures` outer catch shows an error message before clearing `_features`
- [ ] All existing empty `moveFeatureFile` catches gain a `console.error` for contextual logging
- [ ] New l10n keys (`panel.createFailed`, `panel.saveFailed`, `panel.moveFailed`, `panel.updateFailed`, `panel.moveAllFailedOne/Other`, `panel.renameLabelFailedOne/Other`, `panel.deleteLabelFailedOne/Other`, `panel.loadFailed`) added to all three bundles (`en`, `es`, `pt`)
- [ ] `tests/extension/KanbanPanel.fileErrors.test.ts` covers each failure branch with mocked `vscode.workspace.fs` rejections

## Context & constraints
- Design spec: `docs/superpowers/specs/2026-06-02-surface-file-operation-errors-design.md`
- All changes confined to `KanbanPanel.ts`, three l10n bundle files, and one new test file
- Follows the pattern already established by `_archiveAllCards` (bulk partial-success) and `_deleteFeature` (single-feature error)
- `_createFeature` does not need a reload on failure — feature is only pushed to `_features` after a successful write
- `moveFeatureFile` empty catches stay as-is (content correct; wrong-folder reconciles on next load); they only gain `console.error`
- Single-feature write failures reload via `_loadFeatures()` + `_sendFeaturesToWebview()` to restore board state from disk
- Bulk write failures count per-item failures, continue the loop, then warn + reload at the end