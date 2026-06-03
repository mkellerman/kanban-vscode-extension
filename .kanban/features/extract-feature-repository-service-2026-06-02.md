---
id: "extract-feature-repository-service-2026-06-02"
status: "completed"
priority: "medium"
assignee: null
epic: "Architecture remediation"
dueDate: null
created: "2026-06-02T18:00:00.000Z"
modified: "2026-06-03T16:00:52.000Z"
completedAt: "2026-06-03T16:00:52.000Z"
labels: ["refactor", "architecture"]
order: "a2"
---
# Extract a shared FeatureRepository and AgentLauncher

`KanbanPanel`, `SidebarViewProvider`, and `FeatureHeaderProvider` each independently resolve the features directory, load and parse files, wire up watchers, and build AI commands. Extract shared services so the providers become thin view-controllers.

## Context

The absence of a domain layer is the root cause behind the duplicated parsing, the duplicated agent launch, and the scattered file I/O. A `FeatureRepository` (filesystem I/O + parse/serialize + ordering + the in-memory feature list) and an `AgentLauncher` (prompt building + safe execution) would centralise these concerns and make the duplication structurally impossible to reintroduce.

## Acceptance criteria

- [ ] `FeatureRepository` exposes `onDidChange: vscode.Event<readonly Feature[]>`, `features: readonly Feature[]`, `load()`, `getFeaturesDir()`, and the full write API (`createFeature`, `updateFeature`, `moveFeature`, `moveAllFeatures`, `deleteFeature`, `archiveFeatures`, `renameLabel`, `deleteLabel`, `migrateFilenames`).
- [ ] `FeatureRepository` constructor accepts an optional `FsAdapter` parameter so unit tests can inject an in-memory filesystem.
- [ ] The single `vscode.FileSystemWatcher`, echo-suppression sentinel, and `_migrating` flag all live in `FeatureRepository`; no provider creates its own watcher or writes feature files directly.
- [ ] `AgentLauncher.launch(feature, agent, permissionMode)` replaces the ~40-line AI-launch block that was duplicated in `KanbanPanel._startWithAI()` and `FeatureHeaderProvider`'s `startWithAI` handler.
- [ ] `SidebarViewProvider._parseFrontmatter()` (stale regex parser) is deleted; the sidebar subscribes to `repo.onDidChange` instead.
- [ ] `index.ts` constructs `FeatureRepository` and `AgentLauncher` and injects them into all three providers.
- [ ] No user-observable behaviour change; all existing tests pass.
- [ ] New `tests/extension/FeatureRepository.test.ts` covers `load()`, all write methods, echo suppression, and external-edit reload using an injected `FsAdapter`.
- [ ] `KanbanPanel.startWithAI.test.ts` and `FeatureHeaderProvider.startWithAI.test.ts` inject an `AgentLauncher` mock.

## Context & constraints

- Design spec: `docs/superpowers/specs/2026-06-03-extract-feature-repository-agent-launcher-design.md`
- Depends on `consolidate-frontmatter-serialization` (done) and `replace-regex-yaml-parser` (done) — the repository wraps one correct implementation of each concern.
- `2026-06-02-replace-devtool-for-kanban-folder` must land first — it touches the same four files.
- `workspace-picker-2026-06-03` is explicitly deferred and depends on this story.
- Confirmation dialogs (archive, delete/rename label, filename migration) stay in `KanbanPanel`; the repo method is called only after the user confirms.

## Affected files

- `src/extension/KanbanPanel.ts`
- `src/extension/SidebarViewProvider.ts`
- `src/extension/FeatureHeaderProvider.ts`
- `src/extension/index.ts`
- new: `src/extension/FeatureRepository.ts`
- new: `src/extension/AgentLauncher.ts`
- new: `tests/extension/FeatureRepository.test.ts`