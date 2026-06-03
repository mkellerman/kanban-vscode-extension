---
id: "incremental-webview-updates-2026-06-02"
status: "done"
priority: "low"
created: "2026-06-03T08:00:00.000Z"
modified: "2026-06-03T07:23:00.000Z"
completed: "2026-06-03T07:23:00.000Z"
worktree: "/Users/me/Documents/GitHub/kanban-vscode-extension/.claude/worktrees/story+incremental-webview-updates-2026-06-02"
labels: ["performance"]
---

# Incremental Webview Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the single full-list `_sendFeaturesToWebview()` call with three targeted methods so that single-card mutations send only the changed card instead of the whole list.

**Architecture:** Add a `featurePatch` message type to the shared protocol. Split `_sendFeaturesToWebview` into `_initWebview` (full init on open/config-change), `_refreshFeatures` (full feature list for bulk ops and file-watcher), and `_patchFeatures` (single-feature delta for create/update/move/delete/save). Wire the `featurePatch` case in App.tsx using the existing Zustand `addFeature`/`updateFeature`/`removeFeature` actions. Add `useMemo` to `KanbanBoard.tsx` so per-column filter+sort runs only when relevant state changes.

**Tech Stack:** TypeScript, Zustand 5, React 18, Vitest, VS Code extension API

---

## File Map

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `featurePatch` variant to `ExtensionMessage` |
| `src/extension/KanbanPanel.ts` | Add `_relativizeFeature`, `_initWebview`, `_refreshFeatures`, `_patchFeatures`; update 15 call sites; delete `_sendFeaturesToWebview` |
| `src/webview/App.tsx` | Subscribe to `addFeature`/`updateFeature`/`removeFeature`; add `featurePatch` case to message switch |
| `src/webview/components/KanbanBoard.tsx` | Subscribe to filter state slices; memoize per-column feature lists |
| `tests/webview/store.test.ts` | Add combined-patch and large-fixture tests |

---

## Task 1: Extend `ExtensionMessage` in `src/shared/types.ts`

**Files:**
- Modify: `src/shared/types.ts:104-106`

- [x] **Step 1: Add the `featurePatch` variant**

Open `src/shared/types.ts`. Find:
```ts
export type ExtensionMessage =
  | { type: 'init'; features: Feature[]; columns: KanbanColumn[]; settings: CardDisplaySettings; collapsedColumns: string[]; boardViewMode: BoardViewMode; collapsedEpics: string[]; locale: string; translations: Record<string, string> }
  | { type: 'featuresUpdated'; features: Feature[] }
```

Replace with:
```ts
export type ExtensionMessage =
  | { type: 'init'; features: Feature[]; columns: KanbanColumn[]; settings: CardDisplaySettings; collapsedColumns: string[]; boardViewMode: BoardViewMode; collapsedEpics: string[]; locale: string; translations: Record<string, string> }
  | { type: 'featuresUpdated'; features: Feature[] }
  | { type: 'featurePatch'; add?: Feature[]; update?: Feature[]; remove?: string[] }
```

- [x] **Step 2: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors. The new union member is purely additive — no existing code references an exhaustive check on `ExtensionMessage`.

- [x] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add featurePatch to ExtensionMessage protocol"
```

---

## Task 2: Write new store tests (combined patch + large fixture)

**Files:**
- Modify: `tests/webview/store.test.ts`

These tests verify that the Zustand store operations behave correctly when used in the combinations that the `featurePatch` message handler will invoke. All steps use the existing `addFeature`/`updateFeature`/`removeFeature` actions — no new store code is needed.

- [x] **Step 1: Add combined-patch tests after the existing `updateFeature` describe block**

In `tests/webview/store.test.ts`, add after the `describe('updateFeature', ...)` block (after line ~71):

```ts
// ---------------------------------------------------------------------------
// Combined patch operations (mirrors featurePatch message handler)
// ---------------------------------------------------------------------------

describe('combined update + remove', () => {
  it('applies update and remove independently', () => {
    useStore.getState().addFeature(makeFeature({ id: 'keep', priority: 'low' }))
    useStore.getState().addFeature(makeFeature({ id: 'drop', priority: 'medium' }))
    useStore.getState().updateFeature('keep', { priority: 'critical' })
    useStore.getState().removeFeature('drop')
    const state = useStore.getState().features
    expect(state).toHaveLength(1)
    expect(state[0].id).toBe('keep')
    expect(state[0].priority).toBe('critical')
  })
})

describe('updateFeature with unknown id', () => {
  it('is a no-op — array unchanged', () => {
    useStore.getState().addFeature(makeFeature({ id: 'real' }))
    useStore.getState().updateFeature('ghost', { priority: 'high' })
    const state = useStore.getState().features
    expect(state).toHaveLength(1)
    expect(state[0].id).toBe('real')
  })
})
```

- [x] **Step 2: Run the new tests to verify they pass**

```bash
pnpm run test -- --reporter=verbose tests/webview/store.test.ts
```

Expected: all tests PASS (these exercise existing store actions).

- [x] **Step 3: Add the large-fixture correctness test after the `getFilteredFeaturesByStatus` block**

Add at the end of `tests/webview/store.test.ts`:

```ts
// ---------------------------------------------------------------------------
// Large fixture — correctness at scale (1 000 cards)
// ---------------------------------------------------------------------------

function makeLargeFixture(count: number): Feature[] {
  const statuses: FeatureStatus[] = ['backlog', 'todo', 'in-progress', 'review', 'done']
  const priorities = ['low', 'medium', 'high', 'critical'] as const
  return Array.from({ length: count }, (_, i) => ({
    id: `f${i}`,
    status: statuses[i % statuses.length],
    priority: priorities[i % priorities.length],
    assignee: i % 3 === 0 ? `user${i % 5}` : null,
    epic: i % 4 === 0 ? `epic${i % 3}` : null,
    dueDate: null,
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    labels: i % 2 === 0 ? ['a'] : ['b'],
    order: `a${String(i).padStart(6, '0')}`,
    content: `# Feature ${i}`,
    filePath: `/workspace/features/f${i}.md`
  }))
}

describe('large fixture — patch correctness at 1 000 cards', () => {
  it('maintains correct count and field values through add/update/remove sequence', () => {
    const fixtures = makeLargeFixture(1000)
    useStore.setState({ features: fixtures })

    // add 5 new features
    const newFeatures = Array.from({ length: 5 }, (_, i) =>
      makeFeature({ id: `new${i}`, status: 'todo', order: `z${i}` })
    )
    newFeatures.forEach(f => useStore.getState().addFeature(f))
    expect(useStore.getState().features).toHaveLength(1005)

    // update first 10 original features
    for (let i = 0; i < 10; i++) {
      useStore.getState().updateFeature(`f${i}`, { priority: 'critical' })
    }
    for (let i = 0; i < 10; i++) {
      expect(useStore.getState().features.find(f => f.id === `f${i}`)!.priority).toBe('critical')
    }

    // remove 20 original features
    for (let i = 10; i < 30; i++) {
      useStore.getState().removeFeature(`f${i}`)
    }
    expect(useStore.getState().features).toHaveLength(985)
    for (let i = 10; i < 30; i++) {
      expect(useStore.getState().features.find(f => f.id === `f${i}`)).toBeUndefined()
    }

    // verify getFilteredFeaturesByStatus returns the correct subset
    const todoFeatures = useStore.getState().getFilteredFeaturesByStatus('todo')
    const expectedTodoIds = useStore.getState().features
      .filter(f => f.status === 'todo')
      .map(f => f.id)
      .sort()
    expect(todoFeatures.map(f => f.id).sort()).toEqual(expectedTodoIds)
  })
})
```

The test file currently imports only `Feature`. Change line 3:
```ts
// Before
import type { Feature } from '../../src/shared/types'
// After
import type { Feature, FeatureStatus } from '../../src/shared/types'
```

- [x] **Step 4: Run the fixture test to verify it passes**

```bash
pnpm run test -- --reporter=verbose tests/webview/store.test.ts
```

Expected: all tests PASS.

- [x] **Step 5: Commit**

```bash
git add tests/webview/store.test.ts
git commit -m "test: add combined-patch and large-fixture store tests"
```

---

## Task 3: Refactor `KanbanPanel.ts` — split `_sendFeaturesToWebview`

**Files:**
- Modify: `src/extension/KanbanPanel.ts`

**Strategy:** Add the four new methods above the existing `_sendFeaturesToWebview` method body, then update every call site, then delete `_sendFeaturesToWebview`.

- [x] **Step 1: Add `_relativizeFeature` private helper**

Find `private _sendFeaturesToWebview(): void {` (near line 1104). Add these four new methods immediately before it:

```ts
private _relativizeFeature(f: Feature): Feature {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  return workspaceRoot ? { ...f, filePath: path.relative(workspaceRoot, f.filePath) } : f
}

private _initWebview(): void {
  const config = vscode.workspace.getConfiguration('kanban-markdown')

  const defaultColumns: KanbanColumn[] = [
    { id: 'backlog', name: 'Backlog', color: '#6b7280' },
    { id: 'todo', name: 'To Do', color: '#3b82f6' },
    { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
    { id: 'review', name: 'Review', color: '#8b5cf6' },
    { id: 'done', name: 'Done', color: '#22c55e' }
  ]
  const columns = config.get<KanbanColumn[]>('columns', defaultColumns)
  const settings: CardDisplaySettings = {
    showPriorityBadges: config.get<boolean>('showPriorityBadges', true),
    showAssignee: config.get<boolean>('showAssignee', true),
    showDueDate: config.get<boolean>('showDueDate', true),
    showLabels: config.get<boolean>('showLabels', true),
    showEpic: config.get<boolean>('showEpic', true),
    showBuildWithAI: config.get<boolean>('showBuildWithAI', true) && !vscode.workspace.getConfiguration('chat').get<boolean>('disableAIFeatures', false),
    showFileName: config.get<boolean>('showFileName', false),
    compactMode: config.get<boolean>('compactMode', false),
    markdownEditorMode: config.get<boolean>('markdownEditorMode', false),
    hideScrollbar: config.get<boolean>('hideScrollbar', false),
    defaultPriority: config.get<Priority>('defaultPriority', 'medium'),
    defaultStatus: config.get<FeatureStatus>('defaultStatus', 'backlog')
  }

  const collapsedColumns: string[] = this._context.workspaceState.get('kanban-markdown.collapsedColumns', [])
  const boardViewMode: BoardViewMode = this._context.workspaceState.get('kanban-markdown.boardViewMode', 'standard')
  const collapsedEpics: string[] = this._context.workspaceState.get('kanban-markdown.collapsedEpics', [])

  this._panel.webview.postMessage({
    type: 'init',
    features: this._features.map(f => this._relativizeFeature(f)),
    columns,
    settings,
    collapsedColumns,
    boardViewMode,
    collapsedEpics,
    locale: getEffectiveLocale(),
    translations: getBundle()
  })
}

private _refreshFeatures(): void {
  this._panel.webview.postMessage({
    type: 'featuresUpdated',
    features: this._features.map(f => this._relativizeFeature(f))
  })
}

private _patchFeatures(patch: { add?: Feature[]; update?: Feature[]; remove?: string[] }): void {
  this._panel.webview.postMessage({
    type: 'featurePatch',
    add: patch.add?.map(f => this._relativizeFeature(f)),
    update: patch.update?.map(f => this._relativizeFeature(f)),
    remove: patch.remove
  })
}
```

- [x] **Step 2: Update call sites — `ready` handler (was `_sendFeaturesToWebview` → `_initWebview`)**

Find inside `case 'ready':`:
```ts
case 'ready':
  await this._loadFeatures()
  this._sendFeaturesToWebview()
  break
```

Replace with:
```ts
case 'ready':
  await this._loadFeatures()
  this._initWebview()
  break
```

- [x] **Step 3: Update call sites — config change listeners**

Find inside `vscode.workspace.onDidChangeConfiguration`:
```ts
this._loadFeatures().then(() => this._sendFeaturesToWebview())
```
Replace with:
```ts
this._loadFeatures().then(() => this._initWebview())
```

Find:
```ts
} else {
  this._sendFeaturesToWebview()
  if (e.affectsConfiguration('kanban-markdown.filenamePattern')) {
```
Replace with:
```ts
} else {
  this._initWebview()
  if (e.affectsConfiguration('kanban-markdown.filenamePattern')) {
```

Find (the `chat.disableAIFeatures` branch):
```ts
} else if (e.affectsConfiguration('chat.disableAIFeatures')) {
  this._sendFeaturesToWebview()
}
```
Replace with:
```ts
} else if (e.affectsConfiguration('chat.disableAIFeatures')) {
  this._initWebview()
}
```

- [x] **Step 4: Update file-watcher call site → `_refreshFeatures`**

Find inside the debounce callback inside `_setupFileWatcher`:
```ts
await this._loadFeatures()
this._sendFeaturesToWebview()
```
Replace with:
```ts
await this._loadFeatures()
this._refreshFeatures()
```

- [x] **Step 5: Update `_createFeature` → `_patchFeatures({ add })`**

Find at the end of `_createFeature`:
```ts
this._features.push(feature)
this._sendFeaturesToWebview()
```
Replace with:
```ts
this._features.push(feature)
this._patchFeatures({ add: [feature] })
```

- [x] **Step 6: Update `_moveFeature` → `_patchFeatures({ update })`**

Find at the end of `_moveFeature` (after the `crossingDoneBoundary` block):
```ts
this._sendFeaturesToWebview()
```
(This is the final line of `_moveFeature`, after the `} finally { this._migrating = false }` block.)

Replace with:
```ts
this._patchFeatures({ update: [feature] })
```

- [x] **Step 7: Update `_moveAllCards` → `_refreshFeatures`**

Find at the end of `_moveAllCards` (after the outer `try/finally`):
```ts
this._sendFeaturesToWebview()
```
Replace with:
```ts
this._refreshFeatures()
```

- [x] **Step 8: Update `_archiveAllCards` → `_refreshFeatures`**

Find at the end of `_archiveAllCards` (after the optional `showWarningMessage` and before the closing brace):
```ts
this._sendFeaturesToWebview()
```
Replace with:
```ts
this._refreshFeatures()
```

- [x] **Step 9: Update `_deleteFeature` → `_patchFeatures({ remove })`**

Find at the end of `_deleteFeature`:
```ts
await vscode.workspace.fs.delete(vscode.Uri.file(feature.filePath))
this._features = this._features.filter(f => f.id !== featureId)
this._sendFeaturesToWebview()
```
Replace with:
```ts
await vscode.workspace.fs.delete(vscode.Uri.file(feature.filePath))
this._features = this._features.filter(f => f.id !== featureId)
this._patchFeatures({ remove: [featureId] })
```

- [x] **Step 10: Update `_updateFeature` → `_patchFeatures({ update })`**

Find at the end of `_updateFeature` (after the `crossingDoneBoundary` block):
```ts
this._sendFeaturesToWebview()
```
Replace with:
```ts
this._patchFeatures({ update: [feature] })
```

- [x] **Step 11: Update `_saveFeatureContent` → `_patchFeatures({ update })`**

Find at the end of `_saveFeatureContent` (after the `crossingDoneBoundary` block):
```ts
// Update all features in webview
this._sendFeaturesToWebview()
```
Replace with:
```ts
this._patchFeatures({ update: [feature] })
```

- [x] **Step 12: Update `_deleteLabel` → `_refreshFeatures`**

Find at the end of `_deleteLabel`:
```ts
this._sendFeaturesToWebview()
```
Replace with:
```ts
this._refreshFeatures()
```

- [x] **Step 13: Update `_renameLabel` → `_refreshFeatures`**

Find at the end of `_renameLabel` (inside `if (updatedCount > 0)`):
```ts
this._sendFeaturesToWebview()
```
Replace with:
```ts
this._refreshFeatures()
```

- [x] **Step 14: Update `_migrateFilenames` → `_refreshFeatures`**

Find inside `_migrateFilenames` (after `_loadFeatures()`):
```ts
await this._loadFeatures()
this._sendFeaturesToWebview()
```
Replace with:
```ts
await this._loadFeatures()
this._refreshFeatures()
```

- [x] **Step 15: Delete `_sendFeaturesToWebview`**

Delete the entire `private _sendFeaturesToWebview(): void { ... }` method body (lines ~1104–1151).

- [x] **Step 16: Verify TypeScript compiles with no errors**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors. All 15 call sites should now reference `_initWebview`, `_refreshFeatures`, or `_patchFeatures`.

- [x] **Step 17: Commit**

```bash
git add src/extension/KanbanPanel.ts
git commit -m "refactor: split _sendFeaturesToWebview into _initWebview/_refreshFeatures/_patchFeatures"
```

---

## Task 4: Add `featurePatch` handler to `src/webview/App.tsx`

**Files:**
- Modify: `src/webview/App.tsx`

- [x] **Step 1: Subscribe to patch store actions at the top of App**

Find the `useStore()` destructuring near line 17:
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
  setLocale
} = useStore()
```

Replace with:
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
  addFeature,
  updateFeature,
  removeFeature
} = useStore()
```

- [x] **Step 2: Add `featurePatch` case to the message switch**

Find inside the `switch (message.type)` block:
```ts
case 'featuresUpdated':
  setFeatures(message.features)
  break
```

Replace with:
```ts
case 'featuresUpdated':
  setFeatures(message.features)
  break
case 'featurePatch': {
  const { add, update, remove } = message
  if (add) add.forEach(f => addFeature(f))
  if (update) update.forEach(f => updateFeature(f.id, f))
  if (remove) remove.forEach(id => removeFeature(id))
  break
}
```

- [x] **Step 3: Add the new actions to the `useEffect` dependency array**

Find (near line 252):
```ts
}, [setFeatures, setColumns, setCardSettings, setCollapsedColumns, setCollapsedEpics, setBoardViewMode, setLocale])
```

Replace with:
```ts
}, [setFeatures, setColumns, setCardSettings, setCollapsedColumns, setCollapsedEpics, setBoardViewMode, setLocale, addFeature, updateFeature, removeFeature])
```

- [x] **Step 4: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors. TypeScript must be able to resolve the `featurePatch` case against the new `ExtensionMessage` union member added in Task 1.

- [x] **Step 5: Commit**

```bash
git add src/webview/App.tsx
git commit -m "feat: handle featurePatch messages in App.tsx for incremental webview updates"
```

---

## Task 5: Memoize per-column selectors in `src/webview/components/KanbanBoard.tsx`

**Files:**
- Modify: `src/webview/components/KanbanBoard.tsx`

`useMemo` cannot be called inside `.map()` (Rules of Hooks), so both selectors are memoized as Maps keyed by column id. This avoids per-column iteration when neither the feature data nor the active filters have changed.

- [x] **Step 1: Add `useMemo` import**

Find:
```ts
import { useState, useCallback } from 'react'
```

Replace with:
```ts
import { useState, useCallback, useMemo } from 'react'
```

- [x] **Step 2: Subscribe to filter state slices**

Find (after the existing `useStore` subscriptions, near line 27):
```ts
const toggleColumnCollapsed = useStore((s) => s.toggleColumnCollapsed)
const [draggedFeature, setDraggedFeature] = useState<Feature | null>(null)
```

Replace with:
```ts
const toggleColumnCollapsed = useStore((s) => s.toggleColumnCollapsed)
const features = useStore((s) => s.features)
const searchQuery = useStore((s) => s.searchQuery)
const priorityFilter = useStore((s) => s.priorityFilter)
const assigneeFilter = useStore((s) => s.assigneeFilter)
const labelFilter = useStore((s) => s.labelFilter)
const dueDateFilter = useStore((s) => s.dueDateFilter)
const [draggedFeature, setDraggedFeature] = useState<Feature | null>(null)
```

- [x] **Step 3: Add memoized column-feature Maps before the `handleDragStart` callback**

Add immediately after the `useState` declarations (before `const handleDragStart`):

```ts
const filteredByColumn = useMemo(
  () => new Map(columns.map(col => [
    col.id,
    getFilteredFeaturesByStatus(col.id as FeatureStatus, epicFilter)
  ])),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [features, searchQuery, priorityFilter, assigneeFilter, labelFilter, dueDateFilter, columns, epicFilter]
)

const allByColumn = useMemo(
  () => new Map(columns.map(col => [
    col.id,
    getFeaturesByStatus(col.id as FeatureStatus, epicFilter)
  ])),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [features, columns, epicFilter]
)
```

Note: `getFilteredFeaturesByStatus` and `getFeaturesByStatus` are stable Zustand action references and intentionally omitted from the dependency arrays — they do not change between renders. The `eslint-disable` comments prevent the exhaustive-deps lint rule from flagging them.

- [x] **Step 4: Update `handleDrop` to use the memoized Maps**

Find the start of `handleDrop`:
```ts
const filteredFeatures = getFilteredFeaturesByStatus(columnId as FeatureStatus, epicFilter)
```

Replace with:
```ts
const filteredFeatures = filteredByColumn.get(columnId) ?? []
```

Find inside `handleDrop`:
```ts
const allFeatures = getFeaturesByStatus(columnId as FeatureStatus, epicFilter)
  .filter((f) => f.id !== draggedFeature.id)
```

Replace with:
```ts
const allFeatures = (allByColumn.get(columnId) ?? [])
  .filter((f) => f.id !== draggedFeature.id)
```

Update the `handleDrop` dependency array:
```ts
[draggedFeature, dropTarget, getFilteredFeaturesByStatus, getFeaturesByStatus, onMoveFeature, epicFilter]
```

Replace with:
```ts
[draggedFeature, dropTarget, filteredByColumn, allByColumn, onMoveFeature, epicFilter]
```

- [x] **Step 5: Update the JSX render to use the memoized Maps**

Find inside the `columns.map` render:
```tsx
featureCount={getFeaturesByStatus(column.id as FeatureStatus, epicFilter).length}
```

Replace with:
```tsx
featureCount={allByColumn.get(column.id)?.length ?? 0}
```

Find:
```tsx
features={getFilteredFeaturesByStatus(column.id as FeatureStatus, epicFilter)}
```

Replace with:
```tsx
features={filteredByColumn.get(column.id) ?? []}
```

- [x] **Step 6: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [x] **Step 7: Run the full test suite**

```bash
pnpm run test
```

Expected: all tests PASS (the store tests from Tasks 1 and 2, plus all pre-existing tests).

- [x] **Step 8: Commit**

```bash
git add src/webview/components/KanbanBoard.tsx
git commit -m "perf: memoize per-column feature selectors in KanbanBoard"
```

---

## Task 6: Manual smoke tests

There are no automated tests for the VS Code extension host behavior (KanbanPanel) or for the webview message round-trip end-to-end. These must be verified by hand.

- [ ] **Step 1: Build the extension**

```bash
pnpm run build
```

Expected: exits with code 0; `dist/extension.js` and `dist/webview/index.js` are present.

- [ ] **Step 2: Open the extension in the VS Code Extension Development Host**

Press `F5` in VS Code (or run `pnpm run watch` and open the debugger). A new VS Code window launches with the extension active.

- [ ] **Step 3: Smoke test — open panel sends `init`**

Open the Kanban panel. In the browser devtools (if webview devtools available) or by adding a `console.log` to the `case 'init':` handler temporarily: confirm that the initial board loads with all features.

- [ ] **Step 4: Smoke test — card rename sends `featurePatch { update }`**

Open a card in the editor. Change the title. Save (auto-save triggers). Confirm the board reflects the updated title without a full flash/re-render of all columns.

_If VS Code webview DevTools are accessible (Ctrl+Shift+P → "Developer: Open Webview DevTools"), add a temporary console.log to the `case 'featurePatch':` branch to confirm the message is received._

- [ ] **Step 5: Smoke test — drag card to another column sends `featurePatch { update }`**

Drag a card from one column to another. Confirm the card moves correctly.

- [ ] **Step 6: Smoke test — delete card sends `featurePatch { remove }`**

Delete a card. Confirm it disappears from the board.

- [ ] **Step 7: Smoke test — "Move all cards" sends `featuresUpdated`**

Use the column menu to move all cards. Confirm the target column shows the moved cards.

- [ ] **Step 8: Smoke test — external file edit triggers `featuresUpdated`**

Edit a `.kanban/features/*.md` file directly in the VS Code editor. Save. Confirm the board reflects the external change.

- [ ] **Step 9: Smoke test — settings change re-sends `init`**

Change a kanban setting (e.g., toggle "Show Priority Badges"). Confirm the board re-renders correctly.

---

## Test Plan

| Acceptance criterion | How verified |
|---|---|
| Single-feature changes send only the changed feature | Task 6 Step 4–6 (manual): webview DevTools confirm `featurePatch` messages |
| Zustand store applies incremental updates and memoises selectors | Task 2 (unit tests) + Task 5 (`useMemo` implementation) |
| Full-list sync available for initial load and external refreshes | Task 6 Steps 3 and 8 |
| No regression in board correctness; 1,000+ cards | Task 2 large-fixture test |

## Out of Scope

- Per-column store slices (e.g., `Map<columnId, Feature[]>` in Zustand) — full column isolation requires bigger store refactor
- `React.memo` on `KanbanColumn` or `CollapsedColumn` — separate optimization
- `KanbanEpicBoard` memoization — identical pattern, separate story
- Batch coalescing of rapid patches (e.g., debounce multiple patches into one) — YAGNI
- Performance benchmarking or profiling tooling — the 1,000-card fixture is the scale proxy

## Dependencies

None. This is the last story in the architecture remediation sequence and has no blockers.
