# Design: Surface File Operation Errors

**Date:** 2026-06-02
**Story:** surface-file-operation-errors
**Epic:** Reliability

## Summary

Replace silent error handling in `KanbanPanel.ts` filesystem paths with explicit user-visible messages and contextual logging. Single-feature write failures show an error and reload from disk. Bulk write failures report a count and reload. Load failures show an error before clearing state.

## Scope

All changes are confined to `KanbanPanel.ts` and the three l10n bundle files (`en`, `es`, `pt`). No new files, no new abstractions. The pattern follows what `_archiveAllCards` (bulk) and `_deleteFeature` (single) already do.

## Affected Call Sites

| Method | Operation | Current handling | New handling |
|--------|-----------|-----------------|-------------|
| `_createFeature` | `writeFile` | none — throws to handler | try/catch: showErrorMessage, return (no reload needed — feature not yet pushed) |
| `_moveFeature` | `writeFile` | none | try/catch: showErrorMessage + reload |
| `_updateFeature` | `writeFile` | none | try/catch: showErrorMessage + reload |
| `_saveFeatureContent` | `writeFile` | none | try/catch: showErrorMessage + reload |
| `_moveAllCards` | per-feature `writeFile` | none | count failures; if any: showWarningMessage + reload |
| `_renameLabel` | per-feature `writeFile` | none | count failures; if any: showWarningMessage + reload |
| `_deleteLabel` | per-feature `writeFile` | none | count failures; if any: showWarningMessage + reload |
| `_loadFeatures` | outer catch | `_features = []` silently | showErrorMessage before zeroing |
| All move paths | `moveFeatureFile` empty catches | silent | add `console.error` (content already correct; wrong-folder reconciles on next load) |

## Error Handling Rules

### Single-feature write failures

```
try {
  await vscode.workspace.fs.writeFile(...)
} catch (err) {
  console.error('[kanban-extension] writeFile failed:', err)
  vscode.window.showErrorMessage(t('panel.XxxFailed', { error: String(err) }))
  await this._loadFeatures()
  this._sendFeaturesToWebview()
  return
}
```

`_createFeature` skips the reload because the feature is not yet pushed to `_features`.

### Bulk write failures

```
let failedCount = 0
for (const feature of ...) {
  try {
    await vscode.workspace.fs.writeFile(...)
  } catch (err) {
    console.error('[kanban-extension] writeFile failed for', feature.id, err)
    failedCount++
    continue
  }
  // ... optional moveFeatureFile with existing empty catch + console.error
}

if (failedCount > 0) {
  const msg = failedCount === 1
    ? t('panel.XxxFailedOne')
    : t('panel.XxxFailedOther', { count: failedCount })
  vscode.window.showWarningMessage(msg)
  await this._loadFeatures()
  this._sendFeaturesToWebview()
} else {
  this._sendFeaturesToWebview()
}
```

### Load failure

```
} catch (err) {
  console.error('[kanban-extension] _loadFeatures failed:', err)
  vscode.window.showErrorMessage(t('panel.loadFailed', { error: String(err) }))
  this._features = []
}
```

### moveFeatureFile empty catches

Existing empty catches stay (content is correct; wrong-folder reconciles on next load). Each gets a `console.error` added for contextual logging.

## Translation Keys

New keys added to all three l10n bundles:

| Key | English |
|-----|---------|
| `panel.createFailed` | `"Failed to create card: {error}"` |
| `panel.saveFailed` | `"Failed to save card: {error}"` |
| `panel.moveFailed` | `"Failed to move card: {error}"` |
| `panel.updateFailed` | `"Failed to update card: {error}"` |
| `panel.moveAllFailedOne` | `"1 card could not be moved."` |
| `panel.moveAllFailedOther` | `"{count} cards could not be moved."` |
| `panel.renameLabelFailedOne` | `"1 card could not be updated while renaming the label."` |
| `panel.renameLabelFailedOther` | `"{count} cards could not be updated while renaming the label."` |
| `panel.deleteLabelFailedOne` | `"1 card could not be updated while deleting the label."` |
| `panel.deleteLabelFailedOther` | `"{count} cards could not be updated while deleting the label."` |
| `panel.loadFailed` | `"Failed to load board: {error}"` |

## Tests

New file: `tests/extension/KanbanPanel.fileErrors.test.ts`

Mocking approach matches `KanbanPanel.startWithAI.test.ts`: stub `vscode.workspace.fs` and `vscode.window` with `vi.mock`.

| Test | Scenario | Assertion |
|------|----------|-----------|
| `_createFeature` write fails | `writeFile` rejects | `showErrorMessage` called with `createFailed`; feature not in `_features` |
| `_moveFeature` write fails | `writeFile` rejects | `showErrorMessage` called with `moveFailed`; reload triggered |
| `_updateFeature` write fails | `writeFile` rejects | `showErrorMessage` called with `updateFailed`; reload triggered |
| `_saveFeatureContent` write fails | `writeFile` rejects | `showErrorMessage` called with `saveFailed`; reload triggered |
| `_moveAllCards` partial failure | one `writeFile` rejects | warning shown with count; reload triggered |
| `_renameLabel` partial failure | one `writeFile` rejects | warning shown with count; reload triggered |
| `_deleteLabel` partial failure | one `writeFile` rejects | warning shown with count; reload triggered |
| `_loadFeatures` fails | outer `readDirectory` rejects | `showErrorMessage` called with `loadFailed`; `_features` is `[]` |

## Board State Consistency

After any write failure, `_loadFeatures()` restores `_features` from disk before sending to the webview. This guarantees the board reflects actual file state rather than the intended-but-failed in-memory mutation.

`_createFeature` is the exception: since the feature is pushed to `_features` only after a successful write, no reload is needed on failure.
