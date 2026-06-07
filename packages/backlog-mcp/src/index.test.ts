import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { resolve, join } from 'node:path'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { setSessionsDir, encodeProjectDir } from './sessions/reader'
import { WorkItemSchema, SessionSchema } from './contract'
import { FIXTURE_WORK_ITEMS, FIXTURE_SESSIONS } from './fixtures'
import {
  setBoardRoot, listWorkItems, getWorkItem, dependencyGraph,
  computeDependencyGraph, listSessions, getSession, detectFrameworks,
  resolveBoardRoot
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

describe('resolveBoardRoot (env precedence)', () => {
  it('prefers PA_BOARD_ROOT when set', () => {
    expect(resolveBoardRoot({ PA_BOARD_ROOT: '/a', CLAUDE_PROJECT_DIR: '/b' })).toBe('/a')
  })
  it('falls back to CLAUDE_PROJECT_DIR (Claude Code sets it in the server env)', () => {
    expect(resolveBoardRoot({ CLAUDE_PROJECT_DIR: '/b' })).toBe('/b')
  })
  it('treats an empty PA_BOARD_ROOT as unset (e.g. unexpanded ${workspaceFolder})', () => {
    expect(resolveBoardRoot({ PA_BOARD_ROOT: '', CLAUDE_PROJECT_DIR: '/b' })).toBe('/b')
  })
  it('falls back to process.cwd() when neither is set', () => {
    expect(resolveBoardRoot({})).toBe(process.cwd())
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

describe('library write operations', () => {
  let tmpRoot: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'pa-lib-'))
    await mkdir(join(tmpRoot, '.kanban', 'features'), { recursive: true })
    setBoardRoot(tmpRoot)
  })

  afterEach(async () => {
    setBoardRoot(board) // restore — `board` is defined at the top of this test file
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('createItem creates via the native adapter and returns a WorkItem', async () => {
    const { createItem } = await import('./index')
    const item = await createItem({ type: 'story', title: 'Library Story' })
    expect(item.id).toMatch(/^native:library-story-/)
    expect(item.source.framework).toBe('native')
    const items = await listWorkItems()
    expect(items.some((i) => i.id === item.id)).toBe(true)
  })

  it('updateItem patches the item and returns the updated WorkItem', async () => {
    const { createItem, updateItem } = await import('./index')
    const created = await createItem({ type: 'task', title: 'Patch Me' })
    const updated = await updateItem(created.id, { status: 'in-progress' })
    expect(updated.status).toBe('in-progress')
  })

  it('setBody replaces the body', async () => {
    const { createItem, setBody, getItemBody } = await import('./index')
    const created = await createItem({ type: 'story', title: 'Body Story' })
    await setBody(created.id, '# Body Story\n\nreplaced content\n')
    const body = await getItemBody(created.id)
    expect(body).toMatch(/replaced content/)
  })

  it('deleteItem removes the item', async () => {
    const { createItem, deleteItem } = await import('./index')
    const created = await createItem({ type: 'story', title: 'To Delete' })
    await deleteItem(created.id)
    const items = await listWorkItems()
    expect(items.some((i) => i.id === created.id)).toBe(false)
  })

  it('updateItem throws "read-only" for a foreign adapter id', async () => {
    const { updateItem } = await import('./index')
    await expect(updateItem('kanban-markdown:foo', { status: 'done' })).rejects.toThrow(
      'read-only or unknown adapter for "kanban-markdown:foo"'
    )
  })

  it('setBody throws "read-only" for a foreign adapter id', async () => {
    const { setBody } = await import('./index')
    await expect(setBody('kanban-markdown:foo', '# x')).rejects.toThrow(
      'read-only or unknown adapter for "kanban-markdown:foo"'
    )
  })

  it('deleteItem throws "read-only" for a foreign adapter id', async () => {
    const { deleteItem } = await import('./index')
    await expect(deleteItem('kanban-markdown:foo')).rejects.toThrow(
      'read-only or unknown adapter for "kanban-markdown:foo"'
    )
  })
})
