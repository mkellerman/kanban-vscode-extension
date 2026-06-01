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

describe('buildSequence — dependency edges', () => {
  it('renders a linear chain as one root with nested children', () => {
    // B dependsOn A; C dependsOn B
    const result = buildSequence([
      f('A', { priority: 'critical' }),
      f('B', { priority: 'high', dependsOn: ['A'] }),
      f('C', { priority: 'high', dependsOn: ['B'] }),
    ], allActive)
    expect(result.groups).toHaveLength(1)
    const root = result.groups[0].root
    expect(root.feature.id).toBe('A')
    expect(root.children.map(c => c.feature.id)).toEqual(['B'])
    expect(root.children[0].children.map(c => c.feature.id)).toEqual(['C'])
  })

  it('treats a dep on a done feature as satisfied (dependent becomes a root)', () => {
    const result = buildSequence([
      f('A', { status: 'done', priority: 'critical' }),
      f('B', { priority: 'high', dependsOn: ['A'] }),
    ], allActive)
    expect(result.groups.map(g => g.root.feature.id)).toEqual(['B'])
    expect(result.warnings).toEqual([])
  })

  it('treats a dep on a filtered-out feature as satisfied', () => {
    const result = buildSequence([
      f('A', { status: 'backlog', priority: 'critical' }),
      f('B', { status: 'todo', priority: 'high', dependsOn: ['A'] }),
    ], allActive)
    expect(result.groups.map(g => g.root.feature.id)).toEqual(['B'])
  })

  it('emits an unknown-id warning when a dep points to nothing and treats it as satisfied', () => {
    const result = buildSequence([
      f('B', { dependsOn: ['NOPE'] }),
    ], allActive)
    expect(result.groups.map(g => g.root.feature.id)).toEqual(['B'])
    expect(result.warnings).toEqual([{ kind: 'unknown-id', id: 'NOPE' }])
  })

  it('drops self-references silently', () => {
    const result = buildSequence([
      f('A', { dependsOn: ['A'] }),
    ], allActive)
    expect(result.groups.map(g => g.root.feature.id)).toEqual(['A'])
    expect(result.warnings).toEqual([])
  })

  it('sorts children within a subtree by priority/due/id', () => {
    const result = buildSequence([
      f('A', { priority: 'critical' }),
      f('B1', { priority: 'low', dependsOn: ['A'] }),
      f('B2', { priority: 'high', dependsOn: ['A'] }),
      f('B3', { priority: 'medium', dependsOn: ['A'] }),
    ], allActive)
    expect(result.groups[0].root.children.map(c => c.feature.id))
      .toEqual(['B2', 'B3', 'B1'])
  })
})
