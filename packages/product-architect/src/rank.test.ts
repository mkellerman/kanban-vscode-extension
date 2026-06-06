import { describe, it, expect } from 'vitest'
import type { WorkItem } from '@kanban/backlog-mcp'
import { rankReady, unblockImpact } from './rank'

const wi = (id: string, priority: WorkItem['priority'], dependsOn: string[] = []): WorkItem => ({
  id,
  source: { framework: 'native', path: '' },
  type: 'story',
  title: id,
  status: 'todo',
  priority,
  parent: null,
  children: [],
  dependsOn,
  labels: [],
  estimate: null,
  acceptanceCriteria: [],
  bodyRef: ''
})

describe('rankReady', () => {
  it('orders by priority, then unblock-impact', () => {
    const ready = [wi('a', 'high'), wi('b', 'high'), wi('c', 'low')]
    const all = [...ready, wi('x', 'medium', ['b'])] // x depends on b → b has unblock-impact 1
    expect(rankReady(ready, all).map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('treats null priority as medium', () => {
    const ready = [wi('hi', 'high'), wi('mid', null), wi('lo', 'low')]
    expect(rankReady(ready, ready).map((r) => r.id)).toEqual(['hi', 'mid', 'lo'])
  })
})

describe('unblockImpact', () => {
  it('counts direct dependents', () => {
    const all = [wi('a', 'high'), wi('x', 'low', ['a']), wi('y', 'low', ['a'])]
    expect(unblockImpact(all)('a')).toBe(2)
    expect(unblockImpact(all)('x')).toBe(0)
  })
})
