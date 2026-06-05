# Epic Filter — Design Spec

**Date:** 2026-06-03  
**Feature:** Add an epic filter to the Kanban Board toolbar

---

## Summary

Add a toolbar dropdown to filter the Kanban Board by epic, following the same pattern as the existing priority, assignee, label, and due-date filters. The filter is stored in the Zustand store and applied globally — in standard board view it hides non-matching cards; in epic board view it hides non-matching swim lanes.

---

## Store Changes

### New state

```ts
epicFilter: string | 'all'   // default: 'all'
```

The special sentinel value `'no-epic'` selects features that have no epic assigned (`f.epic` is null or empty string). Any other non-`'all'` value is treated as an exact epic name match.

### New action

```ts
setEpicFilter: (epic: string | 'all') => void
```

### Updated actions

- `clearAllFilters`: resets `epicFilter` to `'all'` alongside the other four filters
- `hasActiveFilters`: returns `true` when `epicFilter !== 'all'`

---

## Filter Logic — `getFilteredFeaturesByStatus`

A new guard is inserted after the existing due-date filter, before the search-query check:

```ts
// Epic filter
if (epicFilter !== 'all') {
  const featureEpic = f.epic?.trim() || null
  if (epicFilter === 'no-epic') {
    if (featureEpic !== null) return false
  } else {
    if (featureEpic !== epicFilter) return false
  }
}
```

The function signature is unchanged. The swim-lane `epicLane` parameter continues to scope queries within epic board view; the store filter runs on top of that scoping (redundant-but-harmless when they agree, and vacuously correct when they disagree because `KanbanEpicBoard` hides non-matching lanes before they render).

---

## Epic Board View — `KanbanEpicBoard`

`KanbanEpicBoard` reads `epicFilter` from the store and filters its `lanes` array:

```ts
const epicFilter = useStore(s => s.epicFilter)

const lanes = useMemo(() => {
  const named = getUniqueEpics()
  const hasUngrouped = features.some(f => !f.epic?.trim())
  let out: (string | null)[] = [...named]
  if (hasUngrouped) out.push(null)

  if (epicFilter !== 'all') {
    out = out.filter(e =>
      epicFilter === 'no-epic' ? e === null : e === epicFilter
    )
  }

  return out
}, [features, getUniqueEpics, epicFilter])
```

When a filter is active, only the matching swim lane renders. If the filter matches nothing (e.g. filtering to an epic with no cards), `lanes` is empty and the existing "no swim lanes" empty state message is shown — no new UI needed.

---

## Toolbar UI

A `<select>` dropdown is added between the label filter and the due-date filter, guarded by `cardSettings.showEpic`:

```tsx
{cardSettings.showEpic && (
  <select
    value={epicFilter}
    onChange={(e) => setEpicFilter(e.target.value)}
    className={selectClassName}
  >
    <option value="all">{t('toolbar.allEpics')}</option>
    <option value="no-epic">{t('toolbar.noEpic')}</option>
    {epics.map((epic) => (
      <option key={epic} value={epic}>{epic}</option>
    ))}
  </select>
)}
```

`epics` is sourced from `getUniqueEpics()`, which already exists in the store. The dropdown is visible in both standard and epic board view modes.

The existing `boardViewMode` prop on `Toolbar` requires no changes.

---

## Internationalisation

Two new keys added to all three locale files (`bundle.l10n.en.json`, `bundle.l10n.es.json`, `bundle.l10n.pt.json`):

| Key | English |
|-----|---------|
| `toolbar.allEpics` | All Epics |
| `toolbar.noEpic` | No Epic |

---

## Files Changed

| File | Change |
|------|--------|
| `src/webview/store/index.ts` | Add `epicFilter` state + `setEpicFilter`; update `clearAllFilters`, `hasActiveFilters`, `getFilteredFeaturesByStatus` |
| `src/webview/components/Toolbar.tsx` | Add epic filter `<select>` |
| `src/webview/components/KanbanEpicBoard.tsx` | Filter `lanes` by `epicFilter` |
| `l10n/bundle.l10n.en.json` | Add `toolbar.allEpics`, `toolbar.noEpic` |
| `l10n/bundle.l10n.es.json` | Add `toolbar.allEpics` → "Todos los épicos", `toolbar.noEpic` → "Sin épico" |
| `l10n/bundle.l10n.pt.json` | Add `toolbar.allEpics` → "Todos os épicos", `toolbar.noEpic` → "Sem épico" |

---

## What Is Not Changing

- `KanbanBoardProps.epicFilter` (swim-lane prop) — unchanged
- `getUniqueEpics()` — already exists, no changes needed
- `CardDisplaySettings.showEpic` — already exists, used as the guard
- No new VS Code extension-side (host) changes required — the filter is purely webview state
