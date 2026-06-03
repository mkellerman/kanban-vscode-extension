import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../../src/webview/store'
import type { Feature, FeatureStatus } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const initialState = useStore.getState()

beforeEach(() => {
  useStore.setState(initialState, true)
})

function makeFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'f1',
    status: 'todo',
    priority: 'medium',
    assignee: null,
    epic: null,
    dueDate: null,
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    labels: [],
    order: 'a0',
    content: '# Feature',
    filePath: '/workspace/features/feature.md',
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Feature mutations
// ---------------------------------------------------------------------------

describe('addFeature', () => {
  it('appends a feature to the list', () => {
    const f = makeFeature({ id: 'abc' })
    useStore.getState().addFeature(f)
    expect(useStore.getState().features).toHaveLength(1)
    expect(useStore.getState().features[0].id).toBe('abc')
  })
})

describe('removeFeature', () => {
  it('removes the feature with the given id', () => {
    useStore.getState().addFeature(makeFeature({ id: 'to-remove' }))
    useStore.getState().addFeature(makeFeature({ id: 'keep' }))
    useStore.getState().removeFeature('to-remove')
    const ids = useStore.getState().features.map(f => f.id)
    expect(ids).not.toContain('to-remove')
    expect(ids).toContain('keep')
  })
})

describe('updateFeature', () => {
  it('merges updates into the matching feature', () => {
    useStore.getState().addFeature(makeFeature({ id: 'u1', priority: 'low' }))
    useStore.getState().updateFeature('u1', { priority: 'critical' })
    expect(useStore.getState().features[0].priority).toBe('critical')
  })

  it('leaves other features untouched', () => {
    useStore.getState().addFeature(makeFeature({ id: 'a', status: 'todo' }))
    useStore.getState().addFeature(makeFeature({ id: 'b', status: 'done' }))
    useStore.getState().updateFeature('a', { status: 'in-progress' })
    expect(useStore.getState().features.find(f => f.id === 'b')!.status).toBe('done')
  })
})

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

// ---------------------------------------------------------------------------
// getFeaturesByStatus
// ---------------------------------------------------------------------------

describe('getFeaturesByStatus', () => {
  it('returns only features with the given status', () => {
    useStore.getState().addFeature(makeFeature({ id: '1', status: 'todo' }))
    useStore.getState().addFeature(makeFeature({ id: '2', status: 'done' }))
    useStore.getState().addFeature(makeFeature({ id: '3', status: 'todo' }))
    const results = useStore.getState().getFeaturesByStatus('todo')
    expect(results.map(f => f.id)).toEqual(expect.arrayContaining(['1', '3']))
    expect(results.some(f => f.id === '2')).toBe(false)
  })

  it('returns features sorted by order (lexicographic ascending)', () => {
    useStore.getState().addFeature(makeFeature({ id: 'c', status: 'todo', order: 'a2' }))
    useStore.getState().addFeature(makeFeature({ id: 'a', status: 'todo', order: 'a0' }))
    useStore.getState().addFeature(makeFeature({ id: 'b', status: 'todo', order: 'a1' }))
    const ids = useStore.getState().getFeaturesByStatus('todo').map(f => f.id)
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})

// ---------------------------------------------------------------------------
// getFilteredFeaturesByStatus
// ---------------------------------------------------------------------------

describe('getFilteredFeaturesByStatus', () => {
  beforeEach(() => {
    useStore.getState().addFeature(makeFeature({ id: 'high', status: 'todo', priority: 'high', assignee: 'alice', labels: ['frontend'], order: 'a0' }))
    useStore.getState().addFeature(makeFeature({ id: 'low',  status: 'todo', priority: 'low',  assignee: 'bob',   labels: ['backend'],  order: 'a1' }))
    useStore.getState().addFeature(makeFeature({ id: 'done', status: 'done', priority: 'high', assignee: 'alice', labels: [],           order: 'a0' }))
  })

  it('returns all features for the status when no filters are active', () => {
    expect(useStore.getState().getFilteredFeaturesByStatus('todo')).toHaveLength(2)
  })

  it('filters by priority', () => {
    useStore.setState({ priorityFilter: 'high' })
    const results = useStore.getState().getFilteredFeaturesByStatus('todo')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('high')
  })

  it('filters by assignee', () => {
    useStore.setState({ assigneeFilter: 'bob' })
    const results = useStore.getState().getFilteredFeaturesByStatus('todo')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('low')
  })

  it('filters unassigned features', () => {
    useStore.getState().addFeature(makeFeature({ id: 'unassigned', status: 'todo', assignee: null, order: 'a2' }))
    useStore.setState({ assigneeFilter: 'unassigned' })
    const results = useStore.getState().getFilteredFeaturesByStatus('todo')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('unassigned')
  })

  it('filters by label', () => {
    useStore.setState({ labelFilter: 'label:frontend' })
    const results = useStore.getState().getFilteredFeaturesByStatus('todo')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('high')
  })

  it('filters unlabeled features', () => {
    useStore.getState().addFeature(makeFeature({ id: 'unlabeled', status: 'todo', labels: [], order: 'a3' }))
    useStore.setState({ labelFilter: 'unlabeled' })
    const results = useStore.getState().getFilteredFeaturesByStatus('todo')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('unlabeled')
  })

  it('filters by search query against content', () => {
    useStore.getState().addFeature(makeFeature({ id: 'searchable', status: 'todo', content: '# Fix login bug', order: 'a4' }))
    useStore.setState({ searchQuery: 'login' })
    const results = useStore.getState().getFilteredFeaturesByStatus('todo')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('searchable')
  })

  it('filters by search query against assignee', () => {
    useStore.setState({ searchQuery: 'alice' })
    const results = useStore.getState().getFilteredFeaturesByStatus('todo')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('high')
  })

  it('filters out features without a due date when dueDateFilter is "no-date"', () => {
    useStore.getState().addFeature(makeFeature({ id: 'with-date', status: 'todo', dueDate: '2026-06-01', order: 'a5' }))
    useStore.setState({ dueDateFilter: 'no-date' })
    const ids = useStore.getState().getFilteredFeaturesByStatus('todo').map(f => f.id)
    expect(ids).not.toContain('with-date')
    expect(ids).toContain('high') // high has no due date
  })

  it('filters overdue features', () => {
    useStore.getState().addFeature(makeFeature({ id: 'overdue', status: 'todo', dueDate: '2020-01-01', order: 'a5' }))
    useStore.getState().addFeature(makeFeature({ id: 'future',  status: 'todo', dueDate: '2099-12-31', order: 'a6' }))
    useStore.setState({ dueDateFilter: 'overdue' })
    const ids = useStore.getState().getFilteredFeaturesByStatus('todo').map(f => f.id)
    expect(ids).toContain('overdue')
    expect(ids).not.toContain('future')
  })
})

// ---------------------------------------------------------------------------
// toggleColumnCollapsed
// ---------------------------------------------------------------------------

describe('toggleColumnCollapsed', () => {
  it('adds the column id when not yet collapsed', () => {
    useStore.getState().toggleColumnCollapsed('backlog')
    expect(useStore.getState().collapsedColumns.has('backlog')).toBe(true)
  })

  it('removes the column id when already collapsed', () => {
    useStore.getState().toggleColumnCollapsed('backlog')
    useStore.getState().toggleColumnCollapsed('backlog')
    expect(useStore.getState().collapsedColumns.has('backlog')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// clearAllFilters
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// hasActiveFilters
// ---------------------------------------------------------------------------

describe('hasActiveFilters', () => {
  it('returns false when no filters are active', () => {
    expect(useStore.getState().hasActiveFilters()).toBe(false)
  })

  it('returns true when searchQuery is set', () => {
    useStore.setState({ searchQuery: 'x' })
    expect(useStore.getState().hasActiveFilters()).toBe(true)
  })

  it('returns true when priorityFilter is set', () => {
    useStore.setState({ priorityFilter: 'high' })
    expect(useStore.getState().hasActiveFilters()).toBe(true)
  })

  it('returns true when epicFilter is set', () => {
    useStore.setState({ epicFilter: 'Alpha' })
    expect(useStore.getState().hasActiveFilters()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getUniqueAssignees / getUniqueLabels
// ---------------------------------------------------------------------------

describe('getUniqueAssignees', () => {
  it('returns sorted unique assignees, ignoring nulls', () => {
    useStore.getState().addFeature(makeFeature({ id: '1', assignee: 'charlie' }))
    useStore.getState().addFeature(makeFeature({ id: '2', assignee: 'alice' }))
    useStore.getState().addFeature(makeFeature({ id: '3', assignee: 'alice' }))
    useStore.getState().addFeature(makeFeature({ id: '4', assignee: null }))
    expect(useStore.getState().getUniqueAssignees()).toEqual(['alice', 'charlie'])
  })
})

describe('getUniqueLabels', () => {
  it('returns sorted unique labels across all features', () => {
    useStore.getState().addFeature(makeFeature({ id: '1', labels: ['bug', 'frontend'] }))
    useStore.getState().addFeature(makeFeature({ id: '2', labels: ['frontend', 'ux'] }))
    expect(useStore.getState().getUniqueLabels()).toEqual(['bug', 'frontend', 'ux'])
  })
})

describe('getUniqueEpics', () => {
  it('returns sorted unique epics, ignoring null and empty', () => {
    useStore.getState().addFeature(makeFeature({ id: '1', epic: 'Beta' }))
    useStore.getState().addFeature(makeFeature({ id: '2', epic: 'Alpha' }))
    useStore.getState().addFeature(makeFeature({ id: '3', epic: 'Alpha' }))
    useStore.getState().addFeature(makeFeature({ id: '4', epic: null }))
    expect(useStore.getState().getUniqueEpics()).toEqual(['Alpha', 'Beta'])
  })
})

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

describe('epic lane filtering', () => {
  it('getFilteredFeaturesByStatus respects named epic lane', () => {
    useStore.getState().addFeature(makeFeature({ id: 'a', status: 'todo', epic: 'One' }))
    useStore.getState().addFeature(makeFeature({ id: 'b', status: 'todo', epic: 'Two' }))
    const lane = useStore.getState().getFilteredFeaturesByStatus('todo', 'One')
    expect(lane.map(f => f.id)).toEqual(['a'])
  })

  it('getFilteredFeaturesByStatus with null lane matches tickets without epic', () => {
    useStore.getState().addFeature(makeFeature({ id: 'a', status: 'todo', epic: 'One' }))
    useStore.getState().addFeature(makeFeature({ id: 'b', status: 'todo', epic: null }))
    const lane = useStore.getState().getFilteredFeaturesByStatus('todo', null)
    expect(lane.map(f => f.id)).toEqual(['b'])
  })
})

// ---------------------------------------------------------------------------
// activeFolderName
// ---------------------------------------------------------------------------

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
