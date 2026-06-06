import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { WorkItemSchema, SessionSchema } from './contract'
import { FIXTURE_WORK_ITEMS, FIXTURE_SESSIONS } from './fixtures'
import {
  setBoardRoot, listWorkItems, getWorkItem, dependencyGraph,
  computeDependencyGraph, listSessions, getSession, detectFrameworks
} from './index'

const board = resolve(__dirname, 'adapters/__fixtures__/board')
beforeAll(() => setBoardRoot(board))

describe('contract fixtures', () => {
  it('every work-item fixture satisfies WorkItemSchema', () => {
    for (const wi of FIXTURE_WORK_ITEMS) expect(() => WorkItemSchema.parse(wi)).not.toThrow()
  })
  it('every session fixture satisfies SessionSchema', () => {
    for (const s of FIXTURE_SESSIONS) expect(() => SessionSchema.parse(s)).not.toThrow()
  })
})

describe('library over a real board (native adapter)', () => {
  it('lists and filters work items read from story folders', async () => {
    expect((await listWorkItems()).map((i) => i.id).sort()).toEqual([
      'native:dependency-graph',
      'native:ready-lane-ui'
    ])
    expect((await listWorkItems({ status: 'done' })).map((i) => i.id)).toEqual([
      'native:dependency-graph'
    ])
    expect((await getWorkItem('native:ready-lane-ui'))?.title).toBe('Ready lane UI')
  })

  it('computes the dependency graph from the board', async () => {
    const g = await dependencyGraph()
    expect(g.readySet).toEqual(['native:ready-lane-ui']) // its dep is done; the dep itself is done (not startable)
    expect(g.blocked).toEqual([])
    expect(g.cycles).toEqual([])
  })

  it('detects the native framework', async () => {
    expect((await detectFrameworks()).map((f) => f.framework)).toContain('native')
  })
})

describe('pure dependency graph (cycle-safe)', () => {
  it('terminates and reports a cycle', () => {
    const mk = (id: string, dependsOn: string[]) => ({
      ...FIXTURE_WORK_ITEMS[0], id, status: 'todo' as const, dependsOn
    })
    const g = computeDependencyGraph([mk('a', ['b']), mk('b', ['a'])])
    expect(g.cycles.length).toBeGreaterThanOrEqual(1)
  })
})

describe('sessions (fixture-backed for now)', () => {
  it('lists and links sessions to work items', () => {
    expect(getSession('d75cfc06-19f0-4bd6-889c-9aff5f24be72')?.workItemId).toBe('native:ready-lane-ui')
    expect(listSessions({ workItemId: 'gh:#42' })).toHaveLength(1)
  })
})
