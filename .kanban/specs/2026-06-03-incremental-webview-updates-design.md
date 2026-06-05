---
title: Incremental Webview Updates for Large Boards
date: 2026-06-03
status: draft
---

# Incremental Webview Updates for Large Boards

## Problem

`_sendFeaturesToWebview()` sends the entire feature list to the webview on every mutation — including per-keystroke auto-saves. The webview then replaces the full feature array in the Zustand store and re-derives all filtered/sorted column views. This is wasteful at hundreds to thousands of cards and causes unnecessary re-renders.

## Approach

Split the single `_sendFeaturesToWebview()` method into three targeted send methods. Add a `featurePatch` message type for single-feature mutations. Keep full-list messages for bulk operations and config changes where a targeted patch would be unsafe or impractical.

---

## 1. Message Protocol

### New message type

Add to `ExtensionMessage` in `src/shared/types.ts`:

```ts
| { type: 'featurePatch'; add?: Feature[]; update?: Feature[]; remove?: string[] }
```

All three fields are optional. A patch message may carry any combination of adds, updates, and removes.

### When each message type is sent

| Trigger | Message |
|---|---|
| Panel open / webview ready | `init` (features + columns + settings + locale) |
| Config change (columns, settings, locale) | `init` |
| File watcher fires | `featuresUpdated` (full feature list, no config) |
| `_createFeature` | `featurePatch { add: [feature] }` |
| `_moveFeature` (drag to column) | `featurePatch { update: [feature] }` |
| `_reorderFeature` (drag within column) | `featurePatch { update: [feature] }` |
| `_saveFeatureContent` (keystroke auto-save) | `featurePatch { update: [feature] }` |
| `_updateFeature` | `featurePatch { update: [feature] }` |
| `_deleteFeature` | `featurePatch { remove: [featureId] }` |
| `_moveAllCards` | `featuresUpdated` (full list) |
| `_archiveAllCards` | `featuresUpdated` (full list) |
| `_renameLabel` / `_deleteLabel` | `featuresUpdated` (full list) |
| `_promptFilenamePatternMigration` | `featuresUpdated` (full list) |

Bulk operations (`moveAllCards`, `archiveAllCards`, `renameLabel`, `deleteLabel`) use `featuresUpdated` because the number of affected features is unbounded and a full-list refresh is both safe and inexpensive for these rare, user-triggered operations.

---

## 2. Extension Side (`src/extension/KanbanPanel.ts`)

### Refactoring `_sendFeaturesToWebview`

The single method is replaced by three methods and one private helper:

**`_relativizeFeature(f: Feature): Feature`**  
Returns a copy of `f` with `filePath` replaced by a workspace-relative path. Used by all three send methods.

**`_initWebview()`**  
Reads columns, settings, collapsed state, board view mode, and locale from config and workspace state. Posts `type: 'init'` with the full payload. Replaces the current `_sendFeaturesToWebview()` body. Used on panel open and config changes.

**`_refreshFeatures()`**  
Posts `type: 'featuresUpdated'` with the relativized full feature list. No config re-read. Used by the file watcher and bulk mutation call sites.

**`_patchFeatures(patch: { add?: Feature[]; update?: Feature[]; remove?: string[] })`**  
Relativizes any `Feature` objects in `add` and `update`, then posts `type: 'featurePatch'`. Used by all single-feature mutation call sites.

### Call site mapping (15 total)

| Line | Current | Becomes |
|---|---|---|
| 109 | `_sendFeaturesToWebview()` | `_initWebview()` |
| 223 | `_loadFeatures().then(() => _sendFeaturesToWebview())` | `_loadFeatures().then(() => _initWebview())` |
| 225 | `_sendFeaturesToWebview()` | `_initWebview()` |
| 234 | `_sendFeaturesToWebview()` | `_initWebview()` |
| 260 | `_sendFeaturesToWebview()` (file watcher) | `_refreshFeatures()` |
| 587 | `_sendFeaturesToWebview()` (create) | `_patchFeatures({ add: [feature] })` |
| 636 | `_sendFeaturesToWebview()` (move feature) | `_patchFeatures({ update: [feature] })` |
| 688 | `_sendFeaturesToWebview()` (move all) | `_refreshFeatures()` |
| 754 | `_sendFeaturesToWebview()` (archive all) | `_refreshFeatures()` |
| 764 | `_sendFeaturesToWebview()` (delete) | `_patchFeatures({ remove: [featureId] })` |
| 804 | `_sendFeaturesToWebview()` (update) | `_patchFeatures({ update: [feature] })` |
| 893 | `_sendFeaturesToWebview()` (save content) | `_patchFeatures({ update: [feature] })` |
| 970 | `_sendFeaturesToWebview()` (delete label) | `_refreshFeatures()` |
| 998 | `_sendFeaturesToWebview()` (rename label) | `_refreshFeatures()` |
| 1096 | `_sendFeaturesToWebview()` (filename migration) | `_refreshFeatures()` |

---

## 3. Webview Store & Message Handler

### `src/shared/types.ts`

Add `featurePatch` to `ExtensionMessage`:

```ts
| { type: 'featurePatch'; add?: Feature[]; update?: Feature[]; remove?: string[] }
```

### `src/webview/App.tsx`

Add a `featurePatch` case to the existing `switch (message.type)` block. The store already exposes `addFeature`, `updateFeature`, and `removeFeature` — no new store actions are needed.

```ts
case 'featurePatch': {
  const { add, update, remove } = message
  if (add)    add.forEach(f => addFeature(f))
  if (update) update.forEach(f => updateFeature(f.id, f))
  if (remove) remove.forEach(id => removeFeature(id))
  break
}
```

The `addFeature`, `updateFeature`, and `removeFeature` selectors must be subscribed in the `useEffect` dependency array alongside the existing store selectors.

The `featuresUpdated` case (`setFeatures(message.features)`) is unchanged.

### `src/webview/store/index.ts`

No changes required. `addFeature`, `updateFeature`, and `removeFeature` already implement the correct semantics:

- `addFeature`: appends to the array
- `updateFeature(id, updates)`: spreads updates onto the matching feature
- `removeFeature(id)`: filters out the feature by id

---

## 4. Selector Memoization

### Problem

`getFilteredFeaturesByStatus` and `getFeaturesByStatus` are plain functions in the Zustand store. In `KanbanBoard.tsx` they are called directly during render — once per column per render cycle — recomputing the full filter + sort on every component update regardless of whether the inputs changed.

### Fix

Wrap each column's selector call in `useMemo` in `KanbanBoard.tsx`:

```ts
const filteredFeatures = useMemo(
  () => getFilteredFeaturesByStatus(columnId as FeatureStatus, epicFilter),
  [features, searchQuery, priorityFilter, assigneeFilter, labelFilter, dueDateFilter, columnId, epicFilter]
)

const allFeatures = useMemo(
  () => getFeaturesByStatus(columnId as FeatureStatus, epicFilter),
  [features, columnId, epicFilter]
)
```

With incremental patches, `updateFeature` returns a new array reference (Zustand's immutable update), so React's referential equality check in `useMemo` correctly invalidates only the columns whose feature data changed. Columns whose features were untouched retain their memoized value.

No new dependencies (no Reselect, no `zustand/middleware`).

---

## 5. Testing

### Unit tests — store patch handling

File: `src/webview/store/index.test.ts` (or co-located test file)

- `featurePatch { add }` → feature appears in `features`, array length increases by 1
- `featurePatch { update }` → feature fields are replaced, array length unchanged
- `featurePatch { remove }` → feature is absent from `features`, array length decreases by 1
- Combined `{ update, remove }` → both applied atomically
- Update for unknown id → no-op (array unchanged)

### Correctness regression — large fixture

- Build a reference array of 1,000 `Feature` objects with varied statuses, orders, labels, and assignees
- Apply a sequence of patch operations (add, update, remove, update) to both the store and the reference array
- Assert store state equals the reference array after each operation
- Assert `getFilteredFeaturesByStatus` returns the same result as running the filter logic over the reference array directly

### Manual / E2E smoke tests

- Edit a card title (keystroke auto-save) → board does not flicker; card updates in place
- Drag a card to another column → card moves; no full board flash
- Use "Move all cards" → board refreshes correctly after bulk operation
- Edit a file externally in the VS Code editor → file watcher fires; board reflects the change
- Open a fresh panel → `init` message delivers correct full state

---

## Open Questions

None blocking. This story is explicitly deferred until large boards are a real use case; correctness at scale is verified by the 1,000-card fixture rather than production load.
