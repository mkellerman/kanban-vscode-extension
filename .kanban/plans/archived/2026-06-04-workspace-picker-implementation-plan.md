---
id: "2026-06-04-workspace-picker-implementation-plan"
status: "done"
priority: "medium"
assignee: null
epic: null
dueDate: null
created: "2026-06-05T00:12:02.792Z"
modified: "2026-06-05T00:12:02.792Z"
completedAt: null
labels: []
order: "a0"
workspace: "/Users/me/Documents/GitHub/kanban-vscode-extension/.claude/worktree\
  s/story+workspace-picker-2026-06-03"
---
# Workspace Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let the user switch which folder's Kanban board is shown in the same VS Code window, using a sidebar button that opens a QuickPick.

**Architecture:** Add `setRoot(path)` to `FeatureRepository`, which overrides the workspace root used for all file I/O. `SidebarViewProvider` renders a folder-selector button that triggers a QuickPick; on selection it calls `repo.setRoot()`. All three providers already subscribe to `repo.onDidChange` and refresh for free. The board header (Toolbar) shows the active folder's basename.

**Tech Stack:** TypeScript, VS Code extension API (`showQuickPick`, `showOpenDialog`, `FileSystemWatcher`), React + Zustand (webview), Vitest

---

> **Prerequisite:** The `extract-feature-repository-service-2026-06-02` story must be merged before starting this work. That story creates `src/extension/FeatureRepository.ts` with `getFeaturesDir()`, `load()`, `onDidChange`, and injects `repo` into all three providers. The plan below assumes that baseline exists.

---

## File Structure

**Modified files:**
- `src/extension/FeatureRepository.ts` — add `_rootOverride`, `_loadVersion`, updated `getFeaturesDir()`, new `setRoot()`
- `src/extension/SidebarViewProvider.ts` — folder-selector button, `switchWorkspace` message handler, `folderName` in `update` messages
- `src/extension/KanbanPanel.ts` — pass `activeFolderName` in `_sendFeaturesToWebview()`
- `src/shared/types.ts` — add `activeFolderName?: string` to `init` message
- `src/webview/store/index.ts` — add `activeFolderName` state
- `src/webview/App.tsx` — read `activeFolderName` from `init` message
- `src/webview/components/Toolbar.tsx` — display `activeFolderName` in toolbar right side

**Test files:**
- `tests/extension/FeatureRepository.test.ts` — extend with `setRoot()` test suite

---

## Task 1: Extend `FeatureRepository` with `setRoot()` and `_rootOverride`

**Files:**
- Modify: `src/extension/FeatureRepository.ts`
- Test: `tests/extension/FeatureRepository.test.ts`

- [x] **Step 1.1: Write the failing tests for `setRoot()`**

Add a new `describe('setRoot', ...)` block at the bottom of `tests/extension/FeatureRepository.test.ts`. This file already imports `FeatureRepository` and has a `makeRepo()` helper from the prereq story. Add:

```ts
describe('setRoot', () => {
  it('getFeaturesDir() returns path under the override root when set', () => {
    const repo = makeRepo()
    expect(repo.getFeaturesDir()).toBe('/workspace/.kanban/features')

    repo.setRootSync('/other-repo')  // synchronous helper for testing — see Step 1.3
    expect(repo.getFeaturesDir()).toBe('/other-repo/.kanban/features')
  })

  it('getFeaturesDir() falls back to workspaceFolders[0] after setRoot(null)', () => {
    const repo = makeRepo()
    repo.setRootSync('/other-repo')
    repo.setRootSync(null)
    expect(repo.getFeaturesDir()).toBe('/workspace/.kanban/features')
  })

  it('setRoot() fires onDidChange after load completes', async () => {
    const repo = makeRepo()
    const fired: readonly Feature[][] = []
    repo.onDidChange(features => fired.push(features))

    await repo.setRoot('/other-repo')

    expect(fired).toHaveLength(1)
  })

  it('setRoot() called twice rapidly fires onDidChange only once', async () => {
    const repo = makeRepo()
    const fired: number[] = []
    repo.onDidChange(() => fired.push(Date.now()))

    const p1 = repo.setRoot('/path-a')
    const p2 = repo.setRoot('/path-b')
    await Promise.all([p1, p2])

    expect(fired).toHaveLength(1)
  })
})
```

- [x] **Step 1.2: Run the tests to confirm they fail**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 5 "setRoot"
```

Expected: FAIL — `setRoot is not a function` or similar

- [x] **Step 1.3: Implement `_rootOverride`, `_loadVersion`, updated `getFeaturesDir()`, and `setRoot()`**

Open `src/extension/FeatureRepository.ts`. Add after the existing private fields (e.g., after `private _migrating = false`):

```ts
private _rootOverride: string | null = null
private _loadVersion = 0
```

Replace the existing `getFeaturesDir()` method body:

```ts
getFeaturesDir(): string | null {
  const root = this._rootOverride ?? (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null)
  if (!root) return null
  const config = vscode.workspace.getConfiguration('kanban-extension')
  const featuresDirectory = config.get<string>('featuresDirectory') || '.kanban/features'
  return path.join(root, featuresDirectory)
}
```

Add the `setRoot()` method and a package-private `setRootSync()` test helper right after `getFeaturesDir()`:

```ts
async setRoot(newRoot: string | null): Promise<void> {
  this._rootOverride = newRoot
  if (this._fileWatcher) {
    this._fileWatcher.dispose()
    this._fileWatcher = undefined
  }
  await this.load()
}

/** @internal — test only, bypasses async load */
setRootSync(newRoot: string | null): void {
  this._rootOverride = newRoot
}
```

Find the `load()` method and add version-tracking so rapid `setRoot()` calls don't fire duplicate events. At the **start** of `load()`, before the try/catch, increment the version:

```ts
async load(): Promise<void> {
  const myVersion = ++this._loadVersion
  // ... existing load code (unchanged) ...
  // Replace the final this._onDidChangeEmitter.fire(...) call:
  if (myVersion !== this._loadVersion) return
  this._features = features
  this._onDidChangeEmitter.fire(this._features)
  this._setupFileWatcher()
}
```

> The existing `load()` method already ends with `this._onDidChangeEmitter.fire(this._features)` and calls `this._setupFileWatcher()`. Move those two lines to after the version check, so the full end of `load()` looks like:
>
> ```ts
>   if (myVersion !== this._loadVersion) return
>   this._features = features
>   this._onDidChangeEmitter.fire(this._features)
>   this._setupFileWatcher()
> }
> ```

- [x] **Step 1.4: Run the tests and confirm they pass**

```bash
pnpm test --reporter=verbose 2>&1 | grep -E "setRoot|PASS|FAIL"
```

Expected: all `setRoot` tests PASS

- [x] **Step 1.5: Commit**

```bash
git add src/extension/FeatureRepository.ts tests/extension/FeatureRepository.test.ts
git commit -m "feat: add setRoot() and _rootOverride to FeatureRepository"
```

---

## Task 2: Add `activeFolderName` to webview types and store

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/webview/store/index.ts`

- [x] **Step 2.1: Write failing test for store state**

Add to `tests/webview/store.test.ts`:

```ts
describe('activeFolderName', () => {
  it('defaults to empty string', () => {
    expect(useStore.getState().activeFolderName).toBe('')
  })

  it('setActiveFolderName updates the value', () => {
    useStore.getState().setActiveFolderName('my-repo')
    expect(useStore.getState().activeFolderName).toBe('my-repo')
    useStore.getState().setActiveFolderName('')
  })
})
```

- [x] **Step 2.2: Run tests to confirm failure**

```bash
pnpm test tests/webview/store.test.ts --reporter=verbose 2>&1 | grep -E "activeFolderName|FAIL"
```

Expected: FAIL — `activeFolderName` not in store

- [x] **Step 2.3: Update `src/shared/types.ts` — add `activeFolderName` to `init` message**

Find this line in `types.ts`:

```ts
| { type: 'init'; features: Feature[]; columns: KanbanColumn[]; settings: CardDisplaySettings; collapsedColumns: string[]; boardViewMode: BoardViewMode; collapsedEpics: string[]; locale: string; translations: Record<string, string> }
```

Replace with:

```ts
| { type: 'init'; features: Feature[]; columns: KanbanColumn[]; settings: CardDisplaySettings; collapsedColumns: string[]; boardViewMode: BoardViewMode; collapsedEpics: string[]; locale: string; translations: Record<string, string>; activeFolderName?: string }
```

- [x] **Step 2.4: Update `src/webview/store/index.ts` — add `activeFolderName` state**

In the `KanbanState` interface, add after `collapsedEpics: Set<string>`:

```ts
activeFolderName: string
setActiveFolderName: (name: string) => void
```

In the `create<KanbanState>(...)` body, add the initial value after `collapsedEpics: new Set<string>()`:

```ts
activeFolderName: '',
```

Add the setter after `setCollapsedEpics`:

```ts
setActiveFolderName: (name) => set({ activeFolderName: name }),
```

- [x] **Step 2.5: Run store tests — confirm pass**

```bash
pnpm test tests/webview/store.test.ts --reporter=verbose
```

Expected: PASS

- [x] **Step 2.6: Commit**

```bash
git add src/shared/types.ts src/webview/store/index.ts tests/webview/store.test.ts
git commit -m "feat: add activeFolderName to webview store and init message type"
```

---

## Task 3: Display `activeFolderName` in the board header (Toolbar)

**Files:**
- Modify: `src/webview/App.tsx`
- Modify: `src/webview/components/Toolbar.tsx`

- [x] **Step 3.1: Update `App.tsx` to read `activeFolderName` from `init` messages**

In `App.tsx`, add `setActiveFolderName` to the destructured store values (alongside `setLocale`):

```ts
const {
  columns,
  cardSettings,
  setFeatures,
  setColumns,
  setIsDarkMode,
  setCardSettings,
  setCollapsedColumns,
  setCollapsedEpics,
  boardViewMode,
  setBoardViewMode,
  setLocale,
  setActiveFolderName    // add this
} = useStore()
```

In the `handleMessage` switch, inside the `'init'` case, add after `setBoardViewMode(...)`:

```ts
setActiveFolderName(message.activeFolderName ?? '')
```

Also add `setActiveFolderName` to the `useEffect` dependency array:

```ts
}, [setFeatures, setColumns, setCardSettings, setCollapsedColumns, setCollapsedEpics, setBoardViewMode, setLocale, setActiveFolderName])
```

- [x] **Step 3.2: Update `Toolbar.tsx` to display the active folder name**

Add `Folder` to the lucide-react import (it's already present if you use `FolderOpen` — use whichever is available):

```ts
import { Search, X, Columns, Rows, Settings, Tags, Layers, Folder } from 'lucide-react'
```

Add `activeFolderName` to the destructured store values inside the `Toolbar` function (after `cardSettings`):

```ts
const {
  // ... existing fields ...
  cardSettings,
  activeFolderName
} = useStore()
```

Find the `{/* Keyboard hint */}` div at the end of the toolbar JSX:

```tsx
{/* Keyboard hint */}
<div className="ml-auto text-xs text-zinc-400">
  {t('toolbar.pressKeyToAdd').split('{key}')[0]}<kbd className="px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded">n</kbd>{t('toolbar.pressKeyToAdd').split('{key}')[1]}
</div>
```

Replace it with:

```tsx
{/* Active folder + keyboard hint */}
<div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
  {activeFolderName && (
    <span className="flex items-center gap-1">
      <Folder size={12} />
      {activeFolderName}
    </span>
  )}
  <span>
    {t('toolbar.pressKeyToAdd').split('{key}')[0]}<kbd className="px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded">n</kbd>{t('toolbar.pressKeyToAdd').split('{key}')[1]}
  </span>
</div>
```

- [x] **Step 3.3: Run all tests**

```bash
pnpm test --reporter=verbose
```

Expected: all existing tests PASS (no snapshot regressions)

- [x] **Step 3.4: Commit**

```bash
git add src/webview/App.tsx src/webview/components/Toolbar.tsx
git commit -m "feat: display active folder name in board toolbar header"
```

---

## Task 4: Update `KanbanPanel._sendFeaturesToWebview()` to include `activeFolderName`

**Files:**
- Modify: `src/extension/KanbanPanel.ts`

- [x] **Step 4.1: Update `_sendFeaturesToWebview()`**

In `KanbanPanel.ts`, find `_sendFeaturesToWebview()`. Locate the `this._panel.webview.postMessage({...})` call at the end of that method. Add `activeFolderName` to the message object, right after the `locale` and `translations` fields:

```ts
this._panel.webview.postMessage({
  type: 'init',
  features,
  columns,
  settings,
  collapsedColumns,
  boardViewMode,
  collapsedEpics,
  locale: getEffectiveLocale(),
  translations: getBundle(),
  activeFolderName: path.basename(this._repo.getFeaturesDir() ?? '')
})
```

> `this._repo` is the `FeatureRepository` instance injected by the prereq story. `getFeaturesDir()` now uses `_rootOverride` when set.

- [x] **Step 4.2: Run all tests**

```bash
pnpm test --reporter=verbose
```

Expected: all tests PASS

- [x] **Step 4.3: Commit**

```bash
git add src/extension/KanbanPanel.ts
git commit -m "feat: include activeFolderName in KanbanPanel board init message"
```

---

## Task 5: Add folder-selector button and `switchWorkspace` handler to `SidebarViewProvider`

**Files:**
- Modify: `src/extension/SidebarViewProvider.ts`

- [x] **Step 5.1: Add `folderName` to the `update` message in `_refresh()`**

In `SidebarViewProvider.ts`, find the `_refresh()` method. The prereq story already has it posting an `update` message. Add `folderName` to that message:

```ts
private _refresh(): void {
  if (!this._view) return
  const features = this._repo.features.map(f => ({
    id: f.id,
    title: getTitleFromContent(f.content),
    status: f.status,
    priority: f.priority
  }))
  this._view.webview.postMessage({
    type: 'update',
    features,
    columns: this._getColumns(),
    folderName: path.basename(this._repo.getFeaturesDir() ?? '')
  })
  this._view.webview.postMessage({
    type: 'boardOpenChanged',
    open: !!KanbanPanel.currentPanel
  })
}
```

- [x] **Step 5.2: Handle the `switchWorkspace` message in `resolveWebviewView`**

In `SidebarViewProvider.resolveWebviewView`, add a new case to the `webviewView.webview.onDidReceiveMessage` switch:

```ts
case 'switchWorkspace': {
  const folders = vscode.workspace.workspaceFolders ?? []
  const folderItems = folders.map(f => ({
    label: f.name,
    description: f.uri.fsPath
  }))
  const openItem = { label: 'Open folder…', description: '__open__' }
  const items = [...folderItems, openItem]

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a workspace folder for the Kanban board'
  })
  if (!selected) break

  if (selected.description === '__open__') {
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Select Folder'
    })
    if (!uris || uris.length === 0) break
    await this._repo.setRoot(uris[0].fsPath)
  } else {
    await this._repo.setRoot(selected.description!)
  }
  break
}
```

- [x] **Step 5.3: Add the folder-selector button to `_getHtml()`**

In `_getHtml()`, find the `<div class="actions">` section which currently contains the "Open Board" and "New Feature" buttons. Add the folder-selector button **before** those buttons:

Find this block in `_getHtml()`:

```html
  <div class="actions">
    <button class="btn-primary" id="openBoard">
```

Replace the opening of the actions div with:

```html
  <div class="actions">
    <button class="btn-folder" id="switchWorkspace" title="Switch workspace folder">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.19a2 2 0 0 1 1.45.63l.06.06a1 1 0 0 0 .72.31H13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3.87zm.05.13H2a1 1 0 0 0-.99.91L1 4v8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H7.53a2 2 0 0 1-1.45-.63l-.06-.06a1 1 0 0 0-.72-.31H2.5a1 1 0 0 0-.98.84L1.54 4z"/></svg>
      <span id="folderName">Loading…</span>
      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/></svg>
    </button>
    <button class="btn-primary" id="openBoard">
```

- [x] **Step 5.4: Add CSS for `btn-folder` in `_getHtml()`**

In `_getHtml()`, find the `<style nonce="${nonce}">` block. Add after the `.btn-secondary:hover` rule:

```css
    .btn-folder {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      width: 100%;
      padding: 5px 10px;
      border: 1px solid var(--vscode-panel-border, var(--vscode-sideBarSectionHeader-border, transparent));
      border-radius: 4px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 20px;
      background: var(--vscode-sideBar-background, transparent);
      color: var(--vscode-foreground);
    }
    .btn-folder:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .btn-folder span {
      flex: 1;
      text-align: left;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
```

- [x] **Step 5.5: Wire up the button click and `update` message handler in the webview JS**

In `_getHtml()`, find the `<script nonce="${nonce}">` section. Add the click handler for `switchWorkspace` (alongside the existing `openBoard` and `newFeature` click handlers):

```js
      document.getElementById('switchWorkspace').addEventListener('click', () => {
        vscode.postMessage({ type: 'switchWorkspace' });
      });
```

In the `window.addEventListener('message', ...)` handler, update the `'update'` branch to also update the folder name button label:

```js
        if (msg.type === 'update') {
          columns = msg.columns;
          features = msg.features;
          if (msg.folderName !== undefined) {
            document.getElementById('folderName').textContent = msg.folderName || 'No folder';
          }
          render();
        }
```

- [x] **Step 5.6: Run all tests**

```bash
pnpm test --reporter=verbose
```

Expected: all tests PASS

- [x] **Step 5.7: Commit**

```bash
git add src/extension/SidebarViewProvider.ts
git commit -m "feat: add workspace-picker button and switchWorkspace handler to sidebar"
```

---

## Task 6: Smoke test the full workspace-switch flow

> This task has no automated tests — it verifies the end-to-end behaviour manually.

- [x] **Step 6.1: Build the extension**

```bash
pnpm build
```

Expected: no build errors

- [x] **Step 6.2: Open the extension in VS Code Extension Development Host and verify**

Open this repo in VS Code. Press F5 to launch the Extension Development Host. Then:

1. Open the Kanban board — the toolbar should show the current workspace folder name (e.g. `kanban-vscode-extension`).
2. In the sidebar, the top button should show the same folder name.
3. Click the sidebar folder button — a QuickPick should appear listing workspace folders + "Open folder…".
4. Select "Open folder…" and pick a different folder (or select another workspace folder if you have a multi-root workspace).
5. The board should reload and the toolbar label and sidebar button should both update to the new folder's basename.
6. Open the Kanban board — it should show features from the newly selected folder.
7. Close and reopen VS Code — the board should revert to `workspaceFolders[0]` (no persistence).

- [x] **Step 6.3: Verify no behaviour regression when only one workspace folder is open**

With only one workspace folder open, confirm:
- The toolbar shows the folder name.
- The sidebar button shows the folder name.
- Clicking the sidebar button opens a QuickPick with just that folder + "Open folder…".
- The board continues to work normally.

---

## Test Plan

| Acceptance criterion | Covered by |
|---|---|
| "Switch Workspace" command / sidebar button lists all open workspace folders + "Open folder…" | Task 5 smoke test (Step 6.2) |
| Selecting a folder re-points the board at that folder's `featuresDirectory` without window reload | Task 1 unit tests + Task 6 smoke test |
| Active workspace folder shown in board header | Task 3 (Toolbar) + Task 4 (KanbanPanel) |
| Sidebar stat counts update to reflect selected folder | Task 5 (SidebarViewProvider `_refresh()`) |
| `setRoot(null)` restores `workspaceFolders[0]` | Task 1 unit test |
| No duplicate `onDidChange` from rapid `setRoot()` calls | Task 1 unit test |

---

## Out of Scope

- Persisting the selected folder across VS Code restarts (always resets to `workspaceFolders[0]` on startup).
- Adding the chosen folder to the VS Code workspace (`vscode.workspace.updateWorkspaceFolders`) — only used as a root override for file I/O.
- Per-folder board state (collapsed columns, view mode) — always loads fresh from the new folder's disk.
- A dedicated `kanban-extension.switchWorkspace` VS Code command (command palette entry). The UX entry point is the sidebar button only.

---

## Review Feedback Tasks

- [x] **Fix: `this._features` assignment not version-guarded in success path** (`FeatureRepository.ts` line 215) — move the assignment inside the `if (myVersion === this._loadVersion)` block so a stale concurrent load cannot overwrite valid features.
- [x] **Fix: `this._features = []` in catch block not version-guarded** (`FeatureRepository.ts` lines 216-217) — wrap the catch assignment in the same version check so a stale erroring load cannot zero out features populated by a newer load.
- [x] **Fix: `setRoot()` watcher killed when re-selecting the active folder** (`FeatureRepository.ts` lines 64-66) — `setRoot()` disposes `_fileWatcher` but `load()` skips `_setupWatcher` when `featuresDir` is unchanged; re-selecting the current folder leaves the repo with no file watcher. Fix by clearing `_currentWatcherDir` in `setRoot()` before calling `load()` (forces `_setupWatcher` to always re-run).
- [x] **Fix: async `onDidReceiveMessage` swallows rejections in `switchWorkspace` path** (`SidebarViewProvider.ts` line 43) — wrap the case body in try/catch and show an error message to the user on failure.

---

## Dependencies

- `extract-feature-repository-service-2026-06-02` must be merged first — this plan assumes `FeatureRepository` is in place and injected into all providers, `getFeaturesDir()` exists, and `SidebarViewProvider` / `KanbanPanel` already subscribe to `repo.onDidChange`.