import { describe, it, expect, beforeAll } from 'vitest'
import { resolve, join } from 'node:path'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { setSessionsDir, encodeProjectDir } from './sessions/reader'
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

describe('sessions (read from disk, project-scoped)', () => {
  it('reads project sessions from the configured sessions dir', async () => {
    const proj = '/tmp/pa-demo-project'
    const tmp = await mkdtemp(join(tmpdir(), 'pa-projects-'))
    try {
      const dir = join(tmp, encodeProjectDir(proj))
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'sess-1.jsonl'),
        `{"type":"assistant","timestamp":"2026-06-06T12:00:00.000Z","gitBranch":"story/x","cwd":"${proj}","message":{"role":"assistant","model":"m","usage":{"input_tokens":10,"output_tokens":5},"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"a.ts"}}]}}\n`
      )
      setSessionsDir(tmp)
      setBoardRoot(proj)
      const sessions = await listSessions()
      expect(sessions.map((s) => s.id)).toEqual(['sess-1'])
      expect(sessions[0].lastActivity).toBe('Edit "a.ts"')
      expect((await getSession('sess-1'))?.tokens).toBe(15)
    } finally {
      await rm(tmp, { recursive: true, force: true })
      setBoardRoot(board)
    }
  })
})
