---
id: "workspace-picker-2026-06-03"
status: "done"
priority: "low"
assignee: null
epic: "Architecture remediation"
dueDate: null
created: "2026-06-03T00:00:00.000Z"
modified: "2026-06-03T14:00:00.000Z"
completedAt: "2026-06-03T14:00:00.000Z"
labels: ["ux", "multi-root"]
order: "a1"
worktree: "/Users/me/Documents/GitHub/kanban-vscode-extension/.claude/worktrees/story+workspace-picker-2026-06-03"
---
# Workspace picker: view the Kanban board of any repo in the same window

As a developer working across multiple repos, I want to switch which workspace folder the Kanban board shows without opening a new VS Code window, so I can manage features across projects without context-switching windows.

## Context

Currently the extension binds to `workspaceFolders[0]` (or the folder containing a feature file). Switching repos requires opening a new window. A picker would allow re-pointing `FeatureRepository` at a different root within the same window.

Depends on `extract-feature-repository-service-2026-06-02` landing first: the workspace-picker story assumes `FeatureRepository` is a single injectable instance whose root can be changed or swapped, which is not possible while the file-loading logic is scattered across providers.

## Acceptance criteria

- [x] A "Switch Workspace" command (or board header control) lists all open workspace folders and lets the user pick one.
- [x] Selecting a folder re-points the Kanban board at that folder's `featuresDirectory` without reloading the window.
- [x] The active workspace folder is shown in the board header so the user always knows which repo they're viewing.
- [x] The sidebar stat counts also update to reflect the selected folder.
- [x] Switching back reloads from that folder's disk state (per-folder in-memory state not persisted — see Out of Scope in plan).

## Open questions

- ~~Should the picker also allow folders *outside* the current workspace (arbitrary path via folder-picker dialog)?~~ **Resolved: Yes** — "Open folder…" option calls `showOpenDialog` (plan Task 5.2).
- ~~Should each folder's board state (collapsed columns, view mode) be persisted independently?~~ **Resolved: Out of scope** — deferred per plan; board always loads fresh from disk on switch.