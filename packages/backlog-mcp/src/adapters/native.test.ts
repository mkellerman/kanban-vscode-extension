import { describe, it, expect } from 'vitest'
import { resolve, join, dirname } from 'node:path'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { nativeAdapter } from './native'
import { splitFrontmatter } from './markdown'

const root = resolve(__dirname, '__fixtures__/board')

describe('native adapter', () => {
  it('detects a .kanban board', async () => {
    expect(await nativeAdapter.detect({ root })).toBe(true)
    expect(await nativeAdapter.detect({ root: resolve(__dirname, 'nope') })).toBe(false)
  })

  it('reads story folders into namespaced WorkItems with deps', async () => {
    const items = await nativeAdapter.listItems({ root })
    const ready = items.find((i) => i.id === 'native:ready-lane-ui')
    expect(ready).toBeDefined()
    expect(ready!.status).toBe('todo')
    expect(ready!.priority).toBe('high')
    expect(ready!.title).toBe('Ready lane UI')
    expect(ready!.dependsOn).toEqual(['native:dependency-graph']) // namespaced
    expect(ready!.acceptanceCriteria).toContain('shows ready items')

    expect(items.find((i) => i.id === 'native:dependency-graph')!.status).toBe('done')
  })

  it('reads a body', async () => {
    const body = await nativeAdapter.getBody({ root }, 'native:ready-lane-ui')
    expect(body).toMatch(/# Ready lane UI/)
  })

  it('setStatus writes status back to story.md (round-trip)', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      const dir = join(tmp, '.kanban', 'features', 'x')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'story.md'), '---\nid: "x"\nstatus: "todo"\npriority: "low"\n---\n# X\n', 'utf8')
      await nativeAdapter.setStatus!({ root: tmp }, 'native:x', 'in-progress')
      const items = await nativeAdapter.listItems({ root: tmp })
      expect(items.find((i) => i.id === 'native:x')?.status).toBe('in-progress')
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

describe('native adapter — done/ path resolution', () => {
  async function makeDoneItem(root: string, itemId: string): Promise<void> {
    const dir = join(root, '.kanban', 'features', 'done', itemId)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'story.md'),
      `---\nid: "${itemId}"\nstatus: "done"\npriority: "low"\n---\n# Item ${itemId}\n`,
      'utf8'
    )
  }

  it('setStatus writes correctly when item lives in done/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      await makeDoneItem(root, 'done-item')
      await nativeAdapter.setStatus!({ root }, 'native:done-item', 'in-progress')
      const items = await nativeAdapter.listItems({ root })
      expect(items.find((i) => i.id === 'native:done-item')?.status).toBe('in-progress')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('getBody reads correctly when item lives in done/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      await makeDoneItem(root, 'done-body')
      const body = await nativeAdapter.getBody({ root }, 'native:done-body')
      expect(body).toMatch(/# Item done-body/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('getBody throws for a story that does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      await mkdir(join(root, '.kanban', 'features'), { recursive: true })
      await expect(nativeAdapter.getBody({ root }, 'native:missing')).rejects.toThrow(
        'story not found: missing'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('native adapter — createItem', () => {
  it('creates a story folder + story.md and returns a WorkItem', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      await mkdir(join(root, '.kanban', 'features'), { recursive: true })
      const item = await nativeAdapter.createItem!({ root }, {
        type: 'story',
        title: 'My New Story',
        status: 'todo',
        priority: 'high',
        labels: ['alpha'],
      })
      expect(item.id).toMatch(/^native:my-new-story-\d{4}-\d{2}-\d{2}$/)
      expect(item.type).toBe('story')
      expect(item.title).toBe('My New Story')
      expect(item.status).toBe('todo')
      expect(item.priority).toBe('high')
      expect(item.labels).toEqual(['alpha'])

      // listItems picks it up
      const items = await nativeAdapter.listItems({ root })
      expect(items.some((i) => i.id === item.id)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('defaults status to backlog when not provided', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      await mkdir(join(root, '.kanban', 'features'), { recursive: true })
      const item = await nativeAdapter.createItem!({ root }, { type: 'epic', title: 'My Epic' })
      expect(item.status).toBe('backlog')
      expect(item.type).toBe('epic')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('appends a numeric suffix when the slug already exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      await mkdir(join(root, '.kanban', 'features'), { recursive: true })
      const a = await nativeAdapter.createItem!({ root }, { type: 'task', title: 'Clash' })
      const b = await nativeAdapter.createItem!({ root }, { type: 'task', title: 'Clash' })
      expect(a.id).not.toBe(b.id)
      expect(b.id).toMatch(/-2$/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('includes acceptance criteria in the body when provided', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      await mkdir(join(root, '.kanban', 'features'), { recursive: true })
      const item = await nativeAdapter.createItem!({ root }, {
        type: 'story',
        title: 'AC Story',
        acceptanceCriteria: ['passes tests', 'ships to prod'],
      })
      const body = await nativeAdapter.getBody({ root }, item.id)
      expect(body).toMatch(/- \[ \] passes tests/)
      expect(item.acceptanceCriteria).toEqual(['passes tests', 'ships to prod'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('native adapter — updateItem', () => {
  async function makeItem(root: string, id: string, inDone = false): Promise<void> {
    const dir = join(
      root,
      '.kanban',
      'features',
      ...(inDone ? ['done'] : []),
      id
    )
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'story.md'),
      `---\nid: "${id}"\ntype: "story"\nstatus: "todo"\npriority: "low"\nlabels: []\ndependsOn: []\n---\n# Original title\n\n## Acceptance criteria\n- [ ] original AC\n`,
      'utf8'
    )
  }

  it('patches frontmatter fields and bumps modified', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      await mkdir(join(root, '.kanban', 'features'), { recursive: true })
      await makeItem(root, 'upd-1')
      const before = Date.now()
      const updated = await nativeAdapter.updateItem!({ root }, 'native:upd-1', {
        status: 'in-progress',
        priority: 'high',
        labels: ['beta'],
      })
      expect(updated.status).toBe('in-progress')
      expect(updated.priority).toBe('high')
      expect(updated.labels).toEqual(['beta'])
      // type and title untouched
      expect(updated.type).toBe('story')
      expect(updated.title).toBe('Original title')
      // verify modified timestamp is recent
      const text = await readFile(join(root, '.kanban', 'features', 'upd-1', 'story.md'), 'utf8')
      const { fm } = splitFrontmatter(text)
      expect(new Date(fm.modified as string).getTime()).toBeGreaterThanOrEqual(before)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('updates the h1 title in body when patch.title is provided', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      await mkdir(join(root, '.kanban', 'features'), { recursive: true })
      await makeItem(root, 'upd-title')
      const updated = await nativeAdapter.updateItem!({ root }, 'native:upd-title', {
        title: 'New Title',
      })
      expect(updated.title).toBe('New Title')
      const body = await nativeAdapter.getBody({ root }, 'native:upd-title')
      expect(body).toMatch(/^# New Title/m)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('replaces acceptance criteria section when patch.acceptanceCriteria is provided', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      await mkdir(join(root, '.kanban', 'features'), { recursive: true })
      await makeItem(root, 'upd-ac')
      const updated = await nativeAdapter.updateItem!({ root }, 'native:upd-ac', {
        acceptanceCriteria: ['new AC one', 'new AC two'],
      })
      expect(updated.acceptanceCriteria).toEqual(['new AC one', 'new AC two'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves and writes correctly when item lives in done/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      await mkdir(join(root, '.kanban', 'features', 'done'), { recursive: true })
      await makeItem(root, 'upd-done', true)
      const updated = await nativeAdapter.updateItem!({ root }, 'native:upd-done', {
        priority: 'critical',
      })
      expect(updated.priority).toBe('critical')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('native adapter — setBody', () => {
  it('replaces the body and leaves frontmatter unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      const dir = join(root, '.kanban', 'features', 'body-1')
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'story.md'),
        '---\nid: "body-1"\nstatus: "todo"\npriority: "high"\n---\n# Old body\n',
        'utf8'
      )
      await nativeAdapter.setBody!({ root }, 'native:body-1', '# New body\n\nsome content\n')
      const body = await nativeAdapter.getBody({ root }, 'native:body-1')
      expect(body).toBe('# New body\n\nsome content')
      // frontmatter unchanged
      const items = await nativeAdapter.listItems({ root })
      const item = items.find((i) => i.id === 'native:body-1')!
      expect(item.status).toBe('todo')
      expect(item.priority).toBe('high')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves and writes correctly when item lives in done/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      const dir = join(root, '.kanban', 'features', 'done', 'body-done')
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'story.md'),
        '---\nid: "body-done"\nstatus: "done"\n---\n# Old\n',
        'utf8'
      )
      await nativeAdapter.setBody!({ root }, 'native:body-done', '# Updated\n')
      const body = await nativeAdapter.getBody({ root }, 'native:body-done')
      expect(body).toBe('# Updated')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('native adapter — deleteItem', () => {
  it('removes the item folder and it no longer appears in listItems', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      const dir = join(root, '.kanban', 'features', 'del-1')
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'story.md'),
        '---\nid: "del-1"\nstatus: "todo"\n---\n# Del 1\n',
        'utf8'
      )
      expect((await nativeAdapter.listItems({ root })).some((i) => i.id === 'native:del-1')).toBe(true)
      await nativeAdapter.deleteItem!({ root }, 'native:del-1')
      expect((await nativeAdapter.listItems({ root })).some((i) => i.id === 'native:del-1')).toBe(false)
      // getBody now throws
      await expect(nativeAdapter.getBody({ root }, 'native:del-1')).rejects.toThrow('story not found')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('deletes correctly when item lives in done/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      const dir = join(root, '.kanban', 'features', 'done', 'del-done')
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'story.md'),
        '---\nid: "del-done"\nstatus: "done"\n---\n# Del Done\n',
        'utf8'
      )
      await nativeAdapter.deleteItem!({ root }, 'native:del-done')
      await expect(nativeAdapter.getBody({ root }, 'native:del-done')).rejects.toThrow('story not found')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('native adapter — CRUD conformance round-trip', () => {
  it('create → list → update → setBody → getBody → delete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      await mkdir(join(root, '.kanban', 'features'), { recursive: true })

      // create
      const item = await nativeAdapter.createItem!({ root }, {
        type: 'task',
        title: 'Conformance Task',
        status: 'backlog',
      })
      expect(item.id).toMatch(/^native:conformance-task-/)

      // list finds it
      expect((await nativeAdapter.listItems({ root })).some((i) => i.id === item.id)).toBe(true)

      // update patches it
      const updated = await nativeAdapter.updateItem!({ root }, item.id, { status: 'in-progress' })
      expect(updated.status).toBe('in-progress')

      // setBody + getBody
      await nativeAdapter.setBody!({ root }, item.id, '# Conformance Task\n\nnew body content\n')
      const body = await nativeAdapter.getBody({ root }, item.id)
      expect(body).toMatch(/new body content/)

      // delete removes it
      await nativeAdapter.deleteItem!({ root }, item.id)
      expect((await nativeAdapter.listItems({ root })).some((i) => i.id === item.id)).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('native adapter — flexible recursive discovery', () => {
  async function makeFile(root: string, rel: string, text: string): Promise<void> {
    const full = join(root, rel)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, text, 'utf8')
  }

  /** ctx.kanbanDir = '.kanban' lets the adapter scan the whole board root instead
   *  of just `.kanban/features` (the default that matches files-mode behavior). */
  const flexCtx = (root: string) => ({ root, kanbanDir: '.kanban' })

  it('detects a .kanban folder even without features/ when kanbanDir points there', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pa-native-flex-'))
    try {
      await makeFile(tmp, '.kanban/plans/foo.md', '---\nid: "foo"\nstatus: "todo"\n---\n# Foo\n')
      expect(await nativeAdapter.detect(flexCtx(tmp))).toBe(true)
    } finally { await rm(tmp, { recursive: true, force: true }) }
  })

  it('does not detect when the configured kanbanDir is missing', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pa-native-flex-'))
    try {
      // nothing on disk under .kanban — detect should fail
      expect(await nativeAdapter.detect(flexCtx(tmp))).toBe(false)
    } finally { await rm(tmp, { recursive: true, force: true }) }
  })

  it('lists items from any .md under kanbanDir with status in frontmatter', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pa-native-flex-'))
    try {
      await makeFile(tmp, '.kanban/plans/p1.md',
        '---\nid: "PLAN-1"\nstatus: "todo"\npriority: "low"\ntype: "plan"\n---\n# Plan 1\n')
      await makeFile(tmp, '.kanban/specs/s1.md',
        '---\nid: "SPEC-1"\nstatus: "in-progress"\n---\n# Spec 1\n')
      await makeFile(tmp, '.kanban/milestones/m1.md',
        '---\nid: "M1"\nstatus: "done"\ntype: "milestone"\n---\n# Milestone 1\n')
      await makeFile(tmp, '.kanban/CLAUDE.md', '# Docs no frontmatter\n')

      const items = await nativeAdapter.listItems(flexCtx(tmp))
      const plan = items.find((i) => i.id === 'native:PLAN-1')
      const spec = items.find((i) => i.id === 'native:SPEC-1')
      const ms   = items.find((i) => i.id === 'native:M1')
      expect(plan?.status).toBe('todo')
      expect(plan?.type).toBe('plan')
      expect(spec?.status).toBe('in-progress')
      expect(ms?.type).toBe('milestone')
      expect(items.some((i) => i.source.path.endsWith('CLAUDE.md'))).toBe(false)
    } finally { await rm(tmp, { recursive: true, force: true }) }
  })

  it('derives id from path relative to kanbanDir when frontmatter has no id', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pa-native-flex-'))
    try {
      await makeFile(tmp, '.kanban/plans/no-id.md', '---\nstatus: "backlog"\n---\n# No ID\n')
      const items = await nativeAdapter.listItems(flexCtx(tmp))
      expect(items.some((i) => i.id === 'native:plans/no-id')).toBe(true)
    } finally { await rm(tmp, { recursive: true, force: true }) }
  })

  it('does not duplicate folder-format items via recursive scan', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pa-native-flex-'))
    try {
      const dir = join(tmp, '.kanban', 'features', 'x')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'story.md'),
        '---\nid: "x"\nstatus: "todo"\n---\n# X\n', 'utf8')
      // default kanbanDir = '.kanban/features' (files-mode parity)
      const items = await nativeAdapter.listItems({ root: tmp })
      expect(items.filter((i) => i.id === 'native:x')).toHaveLength(1)
    } finally { await rm(tmp, { recursive: true, force: true }) }
  })

  it('getBody works on a recursively-discovered file when kanbanDir is widened', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pa-native-flex-'))
    try {
      await makeFile(tmp, '.kanban/specs/spec-a.md',
        '---\nid: "SPEC-A"\nstatus: "todo"\n---\n# Spec A\n\nbody here\n')
      const body = await nativeAdapter.getBody(flexCtx(tmp), 'native:SPEC-A')
      expect(body).toMatch(/# Spec A/)
      expect(body).toMatch(/body here/)
    } finally { await rm(tmp, { recursive: true, force: true }) }
  })

  it('default kanbanDir = .kanban/features keeps plans/specs siblings out of scope', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pa-native-flex-'))
    try {
      // a folder-format story under the default kanbanDir
      const dir = join(tmp, '.kanban', 'features', 'inside')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'story.md'),
        '---\nid: "inside"\nstatus: "todo"\n---\n# Inside\n', 'utf8')
      // a plan with status frontmatter living OUTSIDE the default scan root
      await makeFile(tmp, '.kanban/plans/outside.md',
        '---\nid: "OUTSIDE"\nstatus: "todo"\n---\n# Outside\n')

      const items = await nativeAdapter.listItems({ root: tmp })
      expect(items.some((i) => i.id === 'native:inside')).toBe(true)
      // not picked up because it lives outside the default `.kanban/features` scan root
      expect(items.some((i) => i.id === 'native:OUTSIDE')).toBe(false)
    } finally { await rm(tmp, { recursive: true, force: true }) }
  })
})

describe('native adapter — new typed frontmatter fields', () => {
  it('listItems surfaces order/assignee/dueDate/created/modified/completedAt', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pa-native-fields-'))
    try {
      const dir = join(tmp, '.kanban', 'features', 'fielded')
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'story.md'),
        '---\n' +
        'id: "fielded"\n' +
        'status: "in-progress"\n' +
        'priority: "high"\n' +
        'order: "b1"\n' +
        'assignee: "alice"\n' +
        'dueDate: "2026-07-01"\n' +
        'created: "2026-06-01T00:00:00.000Z"\n' +
        'modified: "2026-06-02T00:00:00.000Z"\n' +
        'completedAt: null\n' +
        '---\n# Fielded\n',
        'utf8'
      )
      const items = await nativeAdapter.listItems({ root: tmp })
      const item = items.find((i) => i.id === 'native:fielded')!
      expect(item.order).toBe('b1')
      expect(item.assignee).toBe('alice')
      expect(item.dueDate).toBe('2026-07-01')
      expect(item.created).toBe('2026-06-01T00:00:00.000Z')
      expect(item.modified).toBe('2026-06-02T00:00:00.000Z')
      expect(item.completedAt ?? null).toBeNull()
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('updateItem persists order/assignee/dueDate and refreshes modified', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pa-native-update-'))
    try {
      const dir = join(tmp, '.kanban', 'features', 'u')
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'story.md'),
        '---\nid: "u"\nstatus: "todo"\npriority: "low"\n---\n# U\n',
        'utf8'
      )
      await nativeAdapter.updateItem!({ root: tmp }, 'native:u', {
        order: 'c2',
        assignee: 'bob',
        dueDate: '2026-08-01',
      })
      const items = await nativeAdapter.listItems({ root: tmp })
      const item = items.find((i) => i.id === 'native:u')!
      expect(item.order).toBe('c2')
      expect(item.assignee).toBe('bob')
      expect(item.dueDate).toBe('2026-08-01')
      expect(item.modified).toBeTruthy()
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('updateItem sets completedAt when transitioning to done', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pa-native-done-'))
    try {
      const dir = join(tmp, '.kanban', 'features', 'd')
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'story.md'),
        '---\nid: "d"\nstatus: "in-progress"\npriority: "low"\n---\n# D\n',
        'utf8'
      )
      await nativeAdapter.updateItem!({ root: tmp }, 'native:d', { status: 'done' })
      const item = (await nativeAdapter.listItems({ root: tmp })).find((i) => i.id === 'native:d')!
      expect(item.status).toBe('done')
      expect(item.completedAt).toBeTruthy()
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('createItem accepts order/assignee/dueDate and writes created/modified', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pa-native-create-'))
    try {
      await mkdir(join(tmp, '.kanban', 'features'), { recursive: true })
      const wi = await nativeAdapter.createItem!({ root: tmp }, {
        type: 'story',
        title: 'New thing',
        order: 'a1',
        assignee: 'carol',
        dueDate: '2026-09-01',
      })
      expect(wi.order).toBe('a1')
      expect(wi.assignee).toBe('carol')
      expect(wi.dueDate).toBe('2026-09-01')
      expect(wi.created).toBeTruthy()
      expect(wi.modified).toBeTruthy()
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
