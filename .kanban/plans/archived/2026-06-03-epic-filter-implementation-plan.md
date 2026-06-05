---
id: "2026-06-03-epic-filter-implementation-plan"
status: "done"
priority: "medium"
assignee: null
epic: null
dueDate: null
created: "2026-06-03T17:30:00.000Z"
modified: "2026-06-03T20:22:00.000Z"
completedAt: null
labels: ["filter", "webview"]
order: "a0"
workspace: "/Users/me/Documents/GitHub/kanban-vscode-extension/.claude/worktree\
  s/story+2026-06-03-add-a-epic-filter-to-the-kanban-board"
---
# Epic Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add an epic filter toolbar dropdown that works like the existing priority/assignee/label/due-date filters — backed by Zustand store state, applied in `getFilteredFeaturesByStatus`, and used in `KanbanEpicBoard` to hide non-matching swim lanes.

**Architecture:** The filter value lives in `epicFilter: string | 'all'` in the Zustand store. The sentinel `'no-epic'` selects features with no epic. `getFilteredFeaturesByStatus` applies it after the existing four filters. `KanbanEpicBoard` reads it to skip rendering non-matching lanes. The Toolbar renders a `<select>` guarded by `cardSettings.showEpic`.

**Tech Stack:** TypeScript, React, Zustand, Vitest, `@testing-library/react`

---

## File Map

| File | Change |
|------|--------|
| `src/webview/store/index.ts` | Add `epicFilter` state, `setEpicFilter` action; update `clearAllFilters`, `hasActiveFilters`, `getFilteredFeaturesByStatus` |
| `src/webview/components/Toolbar.tsx` | Add epic filter `<select>`, read `epicFilter`/`setEpicFilter`/`getUniqueEpics` from store |
| `src/webview/components/KanbanEpicBoard.tsx` | Read `epicFilter` from store; filter `lanes` before rendering |
| `l10n/bundle.l10n.en.json` | Add `toolbar.allEpics`, `toolbar.noEpic` |
| `l10n/bundle.l10n.es.json` | Add `toolbar.allEpics`, `toolbar.noEpic` |
| `l10n/bundle.l10n.pt.json` | Add `toolbar.allEpics`, `toolbar.noEpic` |
| `tests/webview/store.test.ts` | Add epic filter tests |
| `tests/webview/components/Toolbar.test.tsx` | New file — epic filter dropdown tests |
| `tests/webview/components/KanbanEpicBoard.test.tsx` | New file — lane filtering tests |

---

## Task 1: Store — `epicFilter` state and `setEpicFilter`

**Files:**
- Modify: `tests/webview/store.test.ts`
- Modify: `src/webview/store/index.ts`

- [x] **Step 1: Write the failing tests**

Append to `tests/webview/store.test.ts` (after the `getUniqueEpics` describe block):

```ts
// ---------------------------------------------------------------------------
// epicFilter state
// ---------------------------------------------------------------------------

describe('epicFilter state', () => {
  it('defaults to "all"', () => {
    expect(useStore.getState().epicFilter).toBe('all')
  })

  it('setEpicFilter updates the value', () => {
    useStore.getState().setEpicFilter('My Epic')
    expect(useStore.getState().epicFilter).toBe('My Epic')
  })

  it('setEpicFilter accepts "all" to reset', () => {
    useStore.getState().setEpicFilter('Alpha')
    useStore.getState().setEpicFilter('all')
    expect(useStore.getState().epicFilter).toBe('all')
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- --reporter=verbose tests/webview/store.test.ts
```

Expected: 3 failures — `epicFilter` property does not exist on state.

- [x] **Step 3: Add `epicFilter` to the store interface**

In `src/webview/store/index.ts`, add to the `KanbanState` interface (after `dueDateFilter: DueDateFilter`):

```ts
epicFilter: string | 'all'
```

Add to the interface actions (after `setDueDateFilter`):

```ts
setEpicFilter: (epic: string | 'all') => void
```

- [x] **Step 4: Add the state default and action**

In `src/webview/store/index.ts`, add to the initial state object (after `dueDateFilter: 'all'`):

```ts
epicFilter: 'all',
```

Add to the actions (after `setDueDateFilter`):

```ts
setEpicFilter: (epic) => set({ epicFilter: epic }),
```

- [x] **Step 5: Run tests to verify they pass**

```bash
pnpm test -- --reporter=verbose tests/webview/store.test.ts
```

Expected: 3 new tests pass, no regressions.

- [x] **Step 6: Commit**

```bash
git add src/webview/store/index.ts tests/webview/store.test.ts
git commit -m "feat: add epicFilter state and setEpicFilter to store"
```

---

## Task 2: Store — filter logic, `clearAllFilters`, `hasActiveFilters`

**Files:**
- Modify: `tests/webview/store.test.ts`
- Modify: `src/webview/store/index.ts`

- [x] **Step 1: Write the failing tests**

Append to `tests/webview/store.test.ts` (after the `epicFilter state` describe block):

```ts
// ---------------------------------------------------------------------------
// getFilteredFeaturesByStatus — epic filter
// ---------------------------------------------------------------------------

describe('getFilteredFeaturesByStatus — epic filter', () => {
  beforeEach(() => {
    useStore.getState().addFeature(makeFeature({ id: 'alpha',   status: 'todo', epic: 'Alpha', order: 'a0' }))
    useStore.getState().addFeature(makeFeature({ id: 'beta',    status: 'todo', epic: 'Beta',  order: 'a1' }))
    useStore.getState().addFeature(makeFeature({ id: 'no-epic', status: 'todo', epic: null,    order: 'a2' }))
  })

  it('returns all features when epicFilter is "all"', () => {
    const results = useStore.getState().getFilteredFeaturesByStatus('todo')
    expect(results).toHaveLength(3)
  })

  it('filters to a named epic', () => {
    useStore.setState({ epicFilter: 'Alpha' })
    const results = useStore.getState().getFilteredFeaturesByStatus('todo')
    expect(results.map(f => f.id)).toEqual(['alpha'])
  })

  it('filters by "no-epic" sentinel — returns features with no epic', () => {
    useStore.setState({ epicFilter: 'no-epic' })
    const results = useStore.getState().getFilteredFeaturesByStatus('todo')
    expect(results.map(f => f.id)).toEqual(['no-epic'])
  })

  it('treats whitespace-only epic as no-epic when filter is "no-epic"', () => {
    useStore.getState().addFeature(makeFeature({ id: 'spaces', status: 'todo', epic: '  ', order: 'a3' }))
    useStore.setState({ epicFilter: 'no-epic' })
    const results = useStore.getState().getFilteredFeaturesByStatus('todo')
    expect(results.map(f => f.id)).toEqual(expect.arrayContaining(['no-epic', 'spaces']))
    expect(results).toHaveLength(2)
  })

  it('does not match features in a different named epic', () => {
    useStore.setState({ epicFilter: 'Alpha' })
    const results = useStore.getState().getFilteredFeaturesByStatus('todo')
    expect(results.some(f => f.id === 'beta')).toBe(false)
    expect(results.some(f => f.id === 'no-epic')).toBe(false)
  })
})
```

Also update the existing `clearAllFilters` test in `tests/webview/store.test.ts` to include `epicFilter`:

Find this block:
```ts
describe('clearAllFilters', () => {
  it('resets all active filters to their defaults', () => {
    useStore.setState({ searchQuery: 'foo', priorityFilter: 'high', assigneeFilter: 'alice', labelFilter: 'label:frontend', dueDateFilter: 'overdue' })
    useStore.getState().clearAllFilters()
    const { searchQuery, priorityFilter, assigneeFilter, labelFilter, dueDateFilter } = useStore.getState()
    expect(searchQuery).toBe('')
    expect(priorityFilter).toBe('all')
    expect(assigneeFilter).toBe('all')
    expect(labelFilter).toBe('all')
    expect(dueDateFilter).toBe('all')
  })
})
```

Replace it with:
```ts
describe('clearAllFilters', () => {
  it('resets all active filters to their defaults', () => {
    useStore.setState({ searchQuery: 'foo', priorityFilter: 'high', assigneeFilter: 'alice', labelFilter: 'label:frontend', dueDateFilter: 'overdue', epicFilter: 'Alpha' })
    useStore.getState().clearAllFilters()
    const { searchQuery, priorityFilter, assigneeFilter, labelFilter, dueDateFilter, epicFilter } = useStore.getState()
    expect(searchQuery).toBe('')
    expect(priorityFilter).toBe('all')
    expect(assigneeFilter).toBe('all')
    expect(labelFilter).toBe('all')
    expect(dueDateFilter).toBe('all')
    expect(epicFilter).toBe('all')
  })
})
```

Also append to the `hasActiveFilters` describe block:
```ts
  it('returns true when epicFilter is set', () => {
    useStore.setState({ epicFilter: 'Alpha' })
    expect(useStore.getState().hasActiveFilters()).toBe(true)
  })
```

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- --reporter=verbose tests/webview/store.test.ts
```

Expected: 5 new failures — `epicFilter` not applied in `getFilteredFeaturesByStatus`, not cleared in `clearAllFilters`, not checked in `hasActiveFilters`.

- [x] **Step 3: Apply `epicFilter` in `getFilteredFeaturesByStatus`**

In `src/webview/store/index.ts`, update `getFilteredFeaturesByStatus`. Find the destructure at the top of the function:

```ts
const {
  features,
  searchQuery,
  priorityFilter,
  assigneeFilter,
  labelFilter,
  dueDateFilter
} = get()
```

Replace it with:

```ts
const {
  features,
  searchQuery,
  priorityFilter,
  assigneeFilter,
  labelFilter,
  dueDateFilter,
  epicFilter
} = get()
```

Then find the due date filter block (ends with `if (dueDateFilter === 'this-week' && !isThisWeek(dueDate)) return false`). Add the epic filter guard immediately after it, before the search query check:

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

- [x] **Step 4: Update `clearAllFilters`**

Find `clearAllFilters` in `src/webview/store/index.ts`:

```ts
  clearAllFilters: () =>
    set({
      searchQuery: '',
      priorityFilter: 'all',
      assigneeFilter: 'all',
      labelFilter: 'all',
      dueDateFilter: 'all'
    }),
```

Replace it with:

```ts
  clearAllFilters: () =>
    set({
      searchQuery: '',
      priorityFilter: 'all',
      assigneeFilter: 'all',
      labelFilter: 'all',
      dueDateFilter: 'all',
      epicFilter: 'all'
    }),
```

- [x] **Step 5: Update `hasActiveFilters`**

Find `hasActiveFilters` in `src/webview/store/index.ts`. Replace the entire function:

```ts
  hasActiveFilters: () => {
    const {
      searchQuery,
      priorityFilter,
      assigneeFilter,
      labelFilter,
      dueDateFilter,
      epicFilter
    } = get()
    return (
      searchQuery !== '' ||
      priorityFilter !== 'all' ||
      assigneeFilter !== 'all' ||
      labelFilter !== 'all' ||
      dueDateFilter !== 'all' ||
      epicFilter !== 'all'
    )
  }
```

- [x] **Step 6: Run tests to verify they pass**

```bash
pnpm test -- --reporter=verbose tests/webview/store.test.ts
```

Expected: all tests pass, no regressions.

- [x] **Step 7: Commit**

```bash
git add src/webview/store/index.ts tests/webview/store.test.ts
git commit -m "feat: apply epicFilter in getFilteredFeaturesByStatus, clearAllFilters, hasActiveFilters"
```

---

## Task 3: i18n — add epic filter translation strings

**Files:**
- Modify: `l10n/bundle.l10n.en.json`
- Modify: `l10n/bundle.l10n.es.json`
- Modify: `l10n/bundle.l10n.pt.json`

No TDD here — these are data files loaded by the test setup (`tests/setup.ts` calls `l10n.config({ contents: enBundle })`). Adding the keys now ensures the Toolbar component tests in Task 4 can look up translated text.

- [x] **Step 1: Add keys to English bundle**

In `l10n/bundle.l10n.en.json`, find the line:
```json
  "toolbar.allDates": "All Dates",
```

Add two new entries immediately before it:
```json
  "toolbar.allEpics": "All Epics",
  "toolbar.noEpic": "No Epic",
```

- [x] **Step 2: Add keys to Spanish bundle**

In `l10n/bundle.l10n.es.json`, find the line:
```json
  "toolbar.allDates": "Todas las fechas",
```

Add two new entries immediately before it:
```json
  "toolbar.allEpics": "Todos los épicos",
  "toolbar.noEpic": "Sin épico",
```

- [x] **Step 3: Add keys to Portuguese bundle**

In `l10n/bundle.l10n.pt.json`, find the line:
```json
  "toolbar.allDates": "Todas as datas",
```

Add two new entries immediately before it:
```json
  "toolbar.allEpics": "Todos os épicos",
  "toolbar.noEpic": "Sem épico",
```

- [x] **Step 4: Commit**

```bash
git add l10n/bundle.l10n.en.json l10n/bundle.l10n.es.json l10n/bundle.l10n.pt.json
git commit -m "i18n: add toolbar.allEpics and toolbar.noEpic translation keys"
```

---

## Task 4: Toolbar — epic filter dropdown

**Files:**
- Create: `tests/webview/components/Toolbar.test.tsx`
- Modify: `src/webview/components/Toolbar.tsx`

- [x] **Step 1: Write the failing tests**

Create `tests/webview/components/Toolbar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toolbar } from '../../../src/webview/components/Toolbar'
import { useStore } from '../../../src/webview/store'
import type { Feature, CardDisplaySettings } from '../../../src/shared/types'

const { mockPostMessage } = vi.hoisted(() => ({ mockPostMessage: vi.fn() }))

vi.mock('../../../src/webview/vscodeApi', () => ({
  vscode: { postMessage: mockPostMessage }
}))

const initialState = useStore.getState()

beforeEach(() => {
  useStore.setState(initialState, true)
  mockPostMessage.mockClear()
})

const CARD_SETTINGS_EPIC_ONLY: CardDisplaySettings = {
  showPriorityBadges: false,
  showAssignee: false,
  showDueDate: false,
  showLabels: false,
  showEpic: true,
  showBuildWithAI: false,
  showFileName: false,
  compactMode: false,
  markdownEditorMode: false,
  hideScrollbar: false,
  defaultPriority: 'medium',
  defaultStatus: 'backlog',
}

function setupToolbar(cardSettings: CardDisplaySettings = CARD_SETTINGS_EPIC_ONLY) {
  useStore.setState({ cardSettings })
  const user = userEvent.setup()
  render(
    <Toolbar
      onOpenSettings={vi.fn()}
      boardViewMode="standard"
      onBoardViewModeChange={vi.fn()}
    />
  )
  return { user }
}

function makeFeature(epic: string | null, id: string): Feature {
  return {
    id,
    status: 'todo',
    priority: 'medium',
    assignee: null,
    epic,
    dueDate: null,
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    labels: [],
    order: 'a0',
    content: `# ${id}`,
    filePath: `/workspace/${id}.md`,
  }
}

describe('Toolbar — epic filter', () => {
  it('renders the epic filter select when cardSettings.showEpic is true', () => {
    setupToolbar()
    expect(screen.getByDisplayValue('All Epics')).toBeInTheDocument()
  })

  it('does not render the epic filter when cardSettings.showEpic is false', () => {
    setupToolbar({ ...CARD_SETTINGS_EPIC_ONLY, showEpic: false })
    expect(screen.queryByDisplayValue('All Epics')).not.toBeInTheDocument()
  })

  it('includes "No Epic" option', () => {
    setupToolbar()
    expect(screen.getByRole('option', { name: 'No Epic' })).toBeInTheDocument()
  })

  it('lists named epics from the store', () => {
    useStore.setState({
      cardSettings: CARD_SETTINGS_EPIC_ONLY,
      features: [makeFeature('Alpha', 'f1'), makeFeature('Beta', 'f2')],
    })
    setupToolbar(CARD_SETTINGS_EPIC_ONLY)
    expect(screen.getByRole('option', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Beta' })).toBeInTheDocument()
  })

  it('calls setEpicFilter when the user changes the selection', async () => {
    useStore.setState({
      cardSettings: CARD_SETTINGS_EPIC_ONLY,
      features: [makeFeature('Gamma', 'f1')],
    })
    const { user } = setupToolbar(CARD_SETTINGS_EPIC_ONLY)
    await user.selectOptions(screen.getByDisplayValue('All Epics'), 'Gamma')
    expect(useStore.getState().epicFilter).toBe('Gamma')
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- --reporter=verbose tests/webview/components/Toolbar.test.tsx
```

Expected: 5 failures — the epic filter select is not rendered yet.

- [x] **Step 3: Update `Toolbar.tsx` — read epic filter from store**

In `src/webview/components/Toolbar.tsx`, update the `useStore()` destructure (add three new entries):

```ts
  const {
    searchQuery,
    setSearchQuery,
    priorityFilter,
    setPriorityFilter,
    assigneeFilter,
    setAssigneeFilter,
    labelFilter,
    setLabelFilter,
    dueDateFilter,
    setDueDateFilter,
    epicFilter,
    setEpicFilter,
    clearAllFilters,
    getUniqueAssignees,
    getUniqueLabels,
    getUniqueEpics,
    hasActiveFilters,
    layout,
    toggleLayout,
    cardSettings
  } = useStore()
```

After `const labels = getUniqueLabels()`, add:

```ts
  const epics = getUniqueEpics()
```

- [x] **Step 4: Add the epic filter `<select>` to the JSX**

In `src/webview/components/Toolbar.tsx`, find the label filter block ending with `)}`:

```tsx
      {/* Label Filter */}
      {cardSettings.showLabels && (
      <select
        ...
      </select>
      )}
```

Insert the epic filter block immediately after the label filter closing `)}` and before the due date filter comment:

```tsx
      {/* Epic Filter */}
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

- [x] **Step 5: Run tests to verify they pass**

```bash
pnpm test -- --reporter=verbose tests/webview/components/Toolbar.test.tsx
```

Expected: all 5 tests pass.

- [x] **Step 6: Run the full test suite to check for regressions**

```bash
pnpm test
```

Expected: all tests pass.

- [x] **Step 7: Commit**

```bash
git add src/webview/components/Toolbar.tsx tests/webview/components/Toolbar.test.tsx
git commit -m "feat: add epic filter dropdown to Toolbar"
```

---

## Task 5: KanbanEpicBoard — filter lanes by `epicFilter`

**Files:**
- Create: `tests/webview/components/KanbanEpicBoard.test.tsx`
- Modify: `src/webview/components/KanbanEpicBoard.tsx`

- [x] **Step 1: Write the failing tests**

Create `tests/webview/components/KanbanEpicBoard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KanbanEpicBoard } from '../../../src/webview/components/KanbanEpicBoard'
import { useStore } from '../../../src/webview/store'
import type { Feature, KanbanColumn } from '../../../src/shared/types'

// Mock vscode API
const { mockPostMessage } = vi.hoisted(() => ({ mockPostMessage: vi.fn() }))
vi.mock('../../../src/webview/vscodeApi', () => ({
  vscode: { postMessage: mockPostMessage }
}))

// Mock KanbanBoard — each instance renders a sentinel so we can check which lanes appear
vi.mock('../../../src/webview/components/KanbanBoard', () => ({
  KanbanBoard: ({ epicFilter }: { epicFilter?: string | null }) => (
    <div data-testid={`kanban-board-lane-${epicFilter ?? '__null__'}`} />
  )
}))

const initialState = useStore.getState()

beforeEach(() => {
  useStore.setState(initialState, true)
  mockPostMessage.mockClear()
})

const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'todo', name: 'To Do', color: '#3b82f6' },
]

function makeFeature(epic: string | null, id: string): Feature {
  return {
    id,
    status: 'todo',
    priority: 'medium',
    assignee: null,
    epic,
    dueDate: null,
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    labels: [],
    order: 'a0',
    content: `# ${id}`,
    filePath: `/workspace/${id}.md`,
  }
}

function setup() {
  render(
    <KanbanEpicBoard
      onFeatureClick={vi.fn()}
      onAddFeature={vi.fn()}
      onMoveFeature={vi.fn()}
    />
  )
}

describe('KanbanEpicBoard — epic filter lane visibility', () => {
  beforeEach(() => {
    useStore.setState({
      columns: DEFAULT_COLUMNS,
      features: [
        makeFeature('Alpha', 'f1'),
        makeFeature('Beta',  'f2'),
        makeFeature(null,    'f3'),
      ],
    })
  })

  it('renders all lanes when epicFilter is "all"', () => {
    setup()
    expect(screen.getByTestId('kanban-board-lane-Alpha')).toBeInTheDocument()
    expect(screen.getByTestId('kanban-board-lane-Beta')).toBeInTheDocument()
    expect(screen.getByTestId('kanban-board-lane-__null__')).toBeInTheDocument()
  })

  it('renders only the matching named lane when a named epic filter is active', () => {
    useStore.setState({ epicFilter: 'Alpha' })
    setup()
    expect(screen.getByTestId('kanban-board-lane-Alpha')).toBeInTheDocument()
    expect(screen.queryByTestId('kanban-board-lane-Beta')).not.toBeInTheDocument()
    expect(screen.queryByTestId('kanban-board-lane-__null__')).not.toBeInTheDocument()
  })

  it('renders only the no-epic lane when epicFilter is "no-epic"', () => {
    useStore.setState({ epicFilter: 'no-epic' })
    setup()
    expect(screen.queryByTestId('kanban-board-lane-Alpha')).not.toBeInTheDocument()
    expect(screen.queryByTestId('kanban-board-lane-Beta')).not.toBeInTheDocument()
    expect(screen.getByTestId('kanban-board-lane-__null__')).toBeInTheDocument()
  })

  it('shows empty state when the filter matches no lanes', () => {
    useStore.setState({ epicFilter: 'Nonexistent' })
    setup()
    // All lane boards absent; the empty-state message appears instead
    expect(screen.queryByTestId(/kanban-board-lane/)).not.toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- --reporter=verbose tests/webview/components/KanbanEpicBoard.test.tsx
```

Expected: 4 failures — `KanbanEpicBoard` doesn't yet read `epicFilter` from the store, so all lanes render regardless of the filter value.

- [x] **Step 3: Update `KanbanEpicBoard.tsx` — read `epicFilter` and filter lanes**

In `src/webview/components/KanbanEpicBoard.tsx`, add `epicFilter` to the store reads (after `const toggleEpicCollapsed`):

```ts
  const epicFilter = useStore(s => s.epicFilter)
```

Then replace the `lanes` useMemo with a version that filters:

```ts
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

- [x] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- --reporter=verbose tests/webview/components/KanbanEpicBoard.test.tsx
```

Expected: all 4 tests pass.

- [x] **Step 5: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass, no regressions.

- [x] **Step 6: Commit**

```bash
git add src/webview/components/KanbanEpicBoard.tsx tests/webview/components/KanbanEpicBoard.test.tsx
git commit -m "feat: filter epic swim lanes by epicFilter in KanbanEpicBoard"
```

---

## Final Verification

- [x] **Build the webview to confirm no type errors**

```bash
pnpm run build:webview
```

Expected: exits 0 with no TypeScript errors.

- [x] **Run full test suite one last time**

```bash
pnpm test
```

Expected: all tests pass.