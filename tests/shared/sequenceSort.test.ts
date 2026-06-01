import { describe, it, expect } from 'vitest'
import type { Feature, FeatureStatus, Priority } from '../../src/shared/types'
import { buildSequence } from '../../src/shared/sequenceSort'

function f(id: string, opts: Partial<Feature> = {}): Feature {
  return {
    id,
    status: 'todo',
    priority: 'medium',
    assignee: null,
    epic: null,
    dueDate: null,
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    labels: [],
    dependsOn: [],
    order: 'a0',
    content: '',
    filePath: `/tmp/${id}.md`,
    ...opts,
  }
}

const allActive = new Set<FeatureStatus>(['todo', 'in-progress', 'review'])

describe('buildSequence — empty + single', () => {
  it('returns empty result for empty input', () => {
    const result = buildSequence([], allActive)
    expect(result.groups).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.blocksCount.size).toBe(0)
  })

  it('returns a single root for a single feature with no deps', () => {
    const result = buildSequence([f('A')], allActive)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].root.feature.id).toBe('A')
    expect(result.groups[0].root.children).toEqual([])
  })
})

describe('buildSequence — root ordering (no deps)', () => {
  it('sorts by priority (critical > high > medium > low)', () => {
    const result = buildSequence([
      f('M', { priority: 'medium' }),
      f('C', { priority: 'critical' }),
      f('L', { priority: 'low' }),
      f('H', { priority: 'high' }),
    ], allActive)
    expect(result.groups.map(g => g.root.feature.id)).toEqual(['C', 'H', 'M', 'L'])
  })

  it('breaks priority ties by due date ascending (nulls last)', () => {
    const result = buildSequence([
      f('B', { priority: 'high', dueDate: null }),
      f('A', { priority: 'high', dueDate: '2026-06-10' }),
      f('C', { priority: 'high', dueDate: '2026-06-05' }),
    ], allActive)
    expect(result.groups.map(g => g.root.feature.id)).toEqual(['C', 'A', 'B'])
  })

  it('breaks due-date ties by id ascending', () => {
    const result = buildSequence([
      f('Z', { priority: 'high', dueDate: '2026-06-05' }),
      f('A', { priority: 'high', dueDate: '2026-06-05' }),
    ], allActive)
    expect(result.groups.map(g => g.root.feature.id)).toEqual(['A', 'Z'])
  })

  it('filters out features whose status is not in visibleStatuses', () => {
    const result = buildSequence([
      f('A', { status: 'backlog' }),
      f('B', { status: 'todo' }),
      f('C', { status: 'done' }),
    ], allActive)
    expect(result.groups.map(g => g.root.feature.id)).toEqual(['B'])
  })
})
