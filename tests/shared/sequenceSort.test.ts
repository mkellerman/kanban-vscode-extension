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

describe('buildSequence — cycles', () => {
  it('breaks a 2-cycle by dropping the edge into the lower-priority node and warns', () => {
    // A.dependsOn = [B], B.dependsOn = [A]
    // A is critical, B is low → break edge INTO B (the lower-priority node), i.e. drop A→B
    const result = buildSequence([
      f('A', { priority: 'critical', dependsOn: ['B'] }),
      f('B', { priority: 'low', dependsOn: ['A'] }),
    ], allActive)

    // Cycle broken → A becomes a root (its edge to B was dropped), B is its child via reverse
    expect(result.groups.map(g => g.root.feature.id)).toEqual(['A'])
    expect(result.groups[0].root.children.map(c => c.feature.id)).toEqual(['B'])
    expect(result.warnings).toEqual([{ kind: 'cycle', edge: { from: 'A', to: 'B' } }])
  })

  it('breaks a 3-cycle at the lowest-priority node and yields a consistent tree', () => {
    // A.dependsOn = [C], B.dependsOn = [A], C.dependsOn = [B]
    // DFS from A walks A→C→B, then sees B→A as a back-edge. Cycle: [A, C, B].
    // Lowest-priority node = C. The cycle edge entering C (in dep-direction) is A→C.
    // Drop A→C → A is freed, becomes root. Tree: A → B → C.
    const result = buildSequence([
      f('A', { priority: 'high', dependsOn: ['C'] }),
      f('B', { priority: 'medium', dependsOn: ['A'] }),
      f('C', { priority: 'low', dependsOn: ['B'] }),
    ], allActive)

    expect(result.warnings).toEqual([{ kind: 'cycle', edge: { from: 'A', to: 'C' } }])
    expect(result.groups.map(g => g.root.feature.id)).toEqual(['A'])
    expect(result.groups[0].root.children.map(c => c.feature.id)).toEqual(['B'])
    expect(result.groups[0].root.children[0].children.map(c => c.feature.id)).toEqual(['C'])
  })
})

describe('buildSequence — multi-parent duplication', () => {
  it('duplicates a dependent that has multiple visible parents (subtree appears under each)', () => {
    // B.dependsOn = [A], C.dependsOn = [A], D.dependsOn = [B, C]
    // Expected: root A has children B and C; D appears under each of B and C.
    const result = buildSequence([
      f('A', { priority: 'critical' }),
      f('B', { priority: 'high', dependsOn: ['A'] }),
      f('C', { priority: 'high', dependsOn: ['A'] }),
      f('D', { priority: 'medium', dependsOn: ['B', 'C'] }),
    ], allActive)
    expect(result.groups).toHaveLength(1)
    const a = result.groups[0].root
    expect(a.feature.id).toBe('A')
    const childIds = a.children.map(c => c.feature.id)
    expect(childIds).toEqual(['B', 'C']) // tie-broken by id
    const bChildren = a.children[0].children.map(c => c.feature.id)
    const cChildren = a.children[1].children.map(c => c.feature.id)
    expect(bChildren).toEqual(['D'])
    expect(cChildren).toEqual(['D']) // duplicated
  })

  it('duplicates the entire subtree under each parent (not just the leaf)', () => {
    // X.dependsOn = [A, B]; Y.dependsOn = [X]
    // Expected: root A has X→Y; root B has X→Y (full subtree dup)
    const result = buildSequence([
      f('A', { priority: 'critical' }),
      f('B', { priority: 'high' }),
      f('X', { priority: 'medium', dependsOn: ['A', 'B'] }),
      f('Y', { priority: 'low', dependsOn: ['X'] }),
    ], allActive)
    expect(result.groups.map(g => g.root.feature.id)).toEqual(['A', 'B'])
    const aSub = result.groups[0].root.children
    const bSub = result.groups[1].root.children
    expect(aSub.map(c => c.feature.id)).toEqual(['X'])
    expect(aSub[0].children.map(c => c.feature.id)).toEqual(['Y'])
    expect(bSub.map(c => c.feature.id)).toEqual(['X'])
    expect(bSub[0].children.map(c => c.feature.id)).toEqual(['Y'])
  })
})
