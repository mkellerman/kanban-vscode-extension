# Switch Project Feature

**Date:** 2026-06-01  
**Status:** Approved

## Summary

Add a "Switch Project" button to the Kanban sidebar panel so the user can point the board at a different repo's root directory without opening a new VS Code window. All board features remain fully functional for the switched project.

## Decisions Made

- **Button placement:** Third button below "New Feature", same column layout as existing buttons.
- **Button label when override active:** Changes to `📂 <folder-name> (Switch…)` — the button itself is the indicator and the return path.
- **Session scope:** Override is held in a module-level variable; resets when VS Code restarts.
- **Returning to workspace:** Clicking the button when an override is set shows a QuickPick with two choices — "Back to workspace (name)" or "Choose another folder…" — before opening the file picker.
- **All features work:** Creating, moving, deleting features all operate on the currently active root.

## Architecture

### New module: `src/extension/projectOverride.ts`

```ts
let _overrideRoot: string | null = null

export function getOverrideRoot(): string | null {
  return _overrideRoot
}

export function setOverrideRoot(root: string | null): void {
  _overrideRoot = root
}
```

Both `KanbanPanel` and `SidebarViewProvider` import `getOverrideRoot()` and use it as:

```ts
const workspaceRoot = getOverrideRoot() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
```

### Files changed

| File | Change |
|---|---|
| `src/extension/projectOverride.ts` | **New** — 6-line override state module |
| `src/extension/SidebarViewProvider.ts` | Add button, `switchProject` handler, `projectChanged` message, root swap |
| `src/extension/KanbanPanel.ts` | Add `reload()` method, root swap at ~8 call sites |

## SidebarViewProvider

### New button (HTML)

```html
<button class="btn-secondary" id="switchProject">
  <svg><!-- folder icon --></svg>
  Switch Project
</button>
```

### Message handler

```
case 'switchProject':
  if override is set:
    show QuickPick:
      - "$(home) Back to workspace (name)" → setOverrideRoot(null)
      - "$(folder) Choose another folder…" → open folder picker
  else:
    open folder picker via showOpenDialog({ canSelectFolders: true, canSelectMany: false })
  
  if user cancels QuickPick or folder picker: no-op, override unchanged

  after selection:
    setOverrideRoot(selectedPath or null)
    post { type: 'projectChanged', folderName: basename or null } to webview
    this._refresh()                          // updates sidebar stats
    KanbanPanel.currentPanel?.reload()       // refreshes board
```

### Webview JS: handle `projectChanged`

```js
} else if (msg.type === 'projectChanged') {
  const btn = document.getElementById('switchProject');
  if (msg.folderName) {
    btn.innerHTML = /* folder icon */ + escapeHtml(msg.folderName) + ' (Switch…)';
  } else {
    btn.innerHTML = /* folder icon */ + 'Switch Project';
  }
}
```

### File watcher update

`_setupFileWatchers()` currently uses:
```ts
new vscode.RelativePattern(workspaceFolder, pattern)
```
Updated to:
```ts
new vscode.RelativePattern(vscode.Uri.file(resolvedRoot), pattern)
```
(VS Code supports `Uri` in `RelativePattern`, enabling watching outside the workspace.)

## KanbanPanel

### New `public reload()` method

```ts
public reload(): void {
  this._loadFeatures().then(() => {
    this._setupFileWatcher()
    this._sendFeaturesToWebview()
  })
}
```

### Root call sites to update (~8 total)

- `_getWorkspaceFeaturesDir()`
- `_setupFileWatcher()`
- `_loadFeatures()`
- `_createFeature()`
- `_moveFeature()`
- `_moveAllCards()`
- `_updateFeature()`
- `_saveFeatureContent()`

Each replaces:
```ts
vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
```
with:
```ts
getOverrideRoot() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
```

The `_setupFileWatcher()` additionally swaps `workspaceFolder` for `vscode.Uri.file(resolvedRoot)` in the `RelativePattern` constructor.

## Out of Scope

- Persistence across VS Code restarts (intentionally session-only for "peek" use case)
- Command palette / keyboard shortcut for switching (can be layered on later via Approach C)
- "New Feature" disabled when on foreign project (all features remain active)
