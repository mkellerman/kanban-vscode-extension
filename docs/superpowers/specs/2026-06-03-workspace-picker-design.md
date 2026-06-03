# Design: Workspace Picker

**Date:** 2026-06-03
**Feature file:** `.kanban/features/workspace-picker-2026-06-03.md`
**Epic:** Architecture remediation

---

## Problem

The extension always binds to `workspaceFolders[0]`. Switching to a different repo's Kanban board requires opening a new VS Code window, forcing a context switch. Developers working across multiple repos need a way to re-point the board within the same window.

---

## Decisions

| Question | Decision |
|---|---|
| Where does the picker live? | Sidebar panel — full-width button at the top |
| Interaction model | Opens VS Code QuickPick overlay on click |
| Scope of options | All open workspace folders + "Open folder…" (arbitrary path via folder-picker) |
| Per-folder board state | None — always loads fresh from disk |
| Persistence across restarts | None — always resets to `workspaceFolders[0]` |
| Architecture | `setRoot(path)` method on `FeatureRepository` |

---

## UX Flow

1. The sidebar shows a full-width button at the very top (above "Open Board" and "New Feature") displaying a folder icon, the active folder's basename, and a chevron.
2. Clicking it fires `vscode.window.showQuickPick` listing all open workspace folder names, with "Open folder…" as the last item.
3. Selecting a workspace folder calls `repo.setRoot(folder.uri.fsPath)`. Selecting "Open folder…" opens a native folder-picker dialog; the chosen path is passed to `repo.setRoot`.
4. The board re-points immediately — no window reload. The sidebar button label and the board header label both update to the new folder's basename.
5. On VS Code restart the selection is forgotten; the board starts with `workspaceFolders[0]`.

---

## Architecture

### `FeatureRepository.setRoot(path)`

```ts
setRoot(path: string | null): Promise<void>
```

- Stores `_rootOverride: string | null`.
- `getFeaturesDir()` returns `_rootOverride` when set, otherwise falls back to the existing workspace-config logic (`kanban-markdown.featuresDirectory` + `workspaceFolders[0]`).
- `setRoot` disposes the current `FileSystemWatcher`, sets the override, then calls `load()`.
- `load()` fires `onDidChange` when complete. All three providers already subscribe to `onDidChange` and update for free — no re-injection required.
- `setRoot(null)` clears the override and reloads from workspace config.

### `SidebarViewProvider`

- Accepts the shared `FeatureRepository` instance (injected from `index.ts` per the prerequisite story's plan).
- Renders the folder-selector button above the existing action buttons in `_getHtml()`.
- Handles a new `switchWorkspace` webview message:
  1. Build QuickPick items from `vscode.workspace.workspaceFolders` + an "Open folder…" item.
  2. On folder selection: `await repo.setRoot(selected.uri.fsPath)`.
  3. On "Open folder…": show `vscode.window.showOpenDialog({ canSelectFolders: true })`, then `await repo.setRoot(chosen[0].fsPath)`.
- Subscribes to `repo.onDidChange` to re-post the active folder name to the webview (updates the button label).

### `KanbanPanel`

- Accepts the shared `FeatureRepository` instance (already planned by prerequisite story).
- Passes `path.basename(repo.getFeaturesDir() ?? '')` to the webview when building board HTML and on each `onDidChange` event.
- Webview displays this basename as a label in the board header so the user always knows which repo they're viewing.

### `index.ts`

No new wiring beyond what the prerequisite story already requires. The same `repo` instance is injected into all three providers; `setRoot` mutates it in place.

---

## Data flow on workspace switch

```
User clicks sidebar button → QuickPick shown
User selects folder
  → repo.setRoot(newPath)
      ├─ disposes FileSystemWatcher
      ├─ sets _rootOverride
      ├─ calls load() → reads new folder's .kanban/features/**/*.md
      └─ fires onDidChange(newFeatures)
  ← SidebarViewProvider.onDidChange → re-posts update + new folder name to sidebar webview
  ← KanbanPanel.onDidChange → _sendFeaturesToWebview() + updates board header label
```

---

## Testing

**`FeatureRepository.test.ts`** (extending the prerequisite story's test file):
- `setRoot(path)` — watcher re-created for new path; `onDidChange` fires with reloaded features.
- `setRoot(null)` — clears override; `getFeaturesDir()` falls back to workspace config.
- Calling `setRoot` while a reload is in-flight does not fire duplicate `onDidChange` events.

**`SidebarViewProvider`** — QuickPick interaction is thin glue over VS Code's native API; covered by manual smoke test.

**`KanbanPanel`** — board header label sourced from `repo.getFeaturesDir()` verified in existing render snapshot tests once the prerequisite story lands.

---

## New files

None.

## Modified files

- `src/extension/FeatureRepository.ts` — add `_rootOverride`, `setRoot()`, update `getFeaturesDir()`
- `src/extension/SidebarViewProvider.ts` — folder-selector button, `switchWorkspace` message handler, `onDidChange` subscription for label updates
- `src/extension/KanbanPanel.ts` — board header label from `repo.getFeaturesDir()`

---

## Constraints and dependencies

- Depends on `extract-feature-repository-service-2026-06-02` landing first: this story assumes `FeatureRepository` exists as a single injectable instance with `getFeaturesDir()`, `load()`, `onDidChange`, and the watcher lifecycle already centralised there.
- No behaviour change when only one workspace folder is open and the user does not use the picker.
- The "Open folder…" path is not added to the VS Code workspace — it is only used as a root override for the Kanban board's file I/O.
