import { describe, it, expect } from 'vitest'
import { WorkItemSchema, SessionSchema } from './contract'
import { FIXTURE_WORK_ITEMS, FIXTURE_SESSIONS } from './fixtures'
import {
  listWorkItems, getWorkItem, dependencyGraph, listSessions, getSession, detectFrameworks
} from './index'

describe('contract fixtures', () => {
  it('every work-item fixture satisfies WorkItemSchema', () => {
    for (const wi of FIXTURE_WORK_ITEMS) expect(() => WorkItemSchema.parse(wi)).not.toThrow()
  })
  it('every session fixture satisfies SessionSchema', () => {
    for (const s of FIXTURE_SESSIONS) expect(() => SessionSchema.parse(s)).not.toThrow()
  })
})

describe('library stub', () => {
  it('lists and filters work items', () => {
    expect(listWorkItems()).toHaveLength(FIXTURE_WORK_ITEMS.length)
    expect(listWorkItems({ framework: 'bmad' }).every((i) => i.source.framework === 'bmad')).toBe(true)
    expect(getWorkItem('native:ready-lane-ui')?.title).toBe('Ready lane UI')
  })

  it('computes the dependency graph (ready / blocked / cycles)', () => {
    const g = dependencyGraph()
    expect(g.readySet).toContain('native:ready-lane-ui') // its only dep is done
    expect(g.readySet).toContain('bmad:epic-1.story-2') // no deps
    expect(g.readySet).not.toContain('native:live-arrows') // dep not done
    expect(g.blocked.find((b) => b.id === 'native:live-arrows')?.waitingOn).toEqual([
      'native:ready-lane-ui'
    ])
    expect(g.cycles).toEqual([])
  })

  it('terminates and reports a cycle (cycle-safe)', () => {
    const a = { ...FIXTURE_WORK_ITEMS[0], id: 'a', status: 'todo' as const, dependsOn: ['b'] }
    const b = { ...FIXTURE_WORK_ITEMS[0], id: 'b', status: 'todo' as const, dependsOn: ['a'] }
    const g = dependencyGraph([a, b])
    expect(g.cycles.length).toBeGreaterThanOrEqual(1)
  })

  it('lists sessions and links them to work items', () => {
    expect(getSession('d75cfc06-19f0-4bd6-889c-9aff5f24be72')?.workItemId).toBe('native:ready-lane-ui')
    expect(listSessions({ workItemId: 'gh:#42' })).toHaveLength(1)
  })

  it('detects the frameworks present', () => {
    const fw = detectFrameworks().map((f) => f.framework)
    expect(fw).toEqual(expect.arrayContaining(['native', 'bmad', 'github']))
  })
})
