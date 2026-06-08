import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { mockCreateFileSystemWatcher } = vi.hoisted(() => {
  const mockWatcher = {
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  }
  const mockCreateFileSystemWatcher = vi.fn(() => mockWatcher)
  return { mockCreateFileSystemWatcher }
})

vi.mock('vscode', () => ({
  workspace: {
    createFileSystemWatcher: mockCreateFileSystemWatcher,
  },
  EventEmitter: class<T> {
    private _ls: ((e: T) => void)[] = []
    event = (cb: (e: T) => void) => {
      this._ls.push(cb)
      return { dispose: () => { const i = this._ls.indexOf(cb); if (i >= 0) this._ls.splice(i, 1) } }
    }
    fire(e: T) { [...this._ls].forEach(l => l(e)) }
    dispose() { this._ls = [] }
  },
  RelativePattern: class { constructor(public base: unknown, public pattern: string) {} },
  Uri: { file: (p: string) => ({ fsPath: p }) },
}))

import { McpFeatureRepository } from '../../src/extension/McpFeatureRepository'

async function makeStory(root: string, folder: string, content: string): Promise<void> {
  const dir = join(root, '.kanban', 'features', folder)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'story.md'), content, 'utf8')
}

describe('McpFeatureRepository', () => {
  let tmp: string
  let repo: McpFeatureRepository

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mcp-repo-'))
  })

  afterEach(async () => {
    repo?.dispose()
    await rm(tmp, { recursive: true, force: true })
  })

  it('load() lists native stories as Features with namespaced ids', async () => {
    await makeStory(tmp, 'alpha',
      '---\nid: "alpha"\nstatus: "todo"\npriority: "high"\norder: "a1"\n---\n# Alpha\n')
    repo = new McpFeatureRepository(tmp)
    await repo.load()
    const feat = repo.features.find(f => f.id === 'native:alpha')
    expect(feat).toBeDefined()
    expect(feat!.status).toBe('todo')
    expect(feat!.priority).toBe('high')
    expect(feat!.order).toBe('a1')
    expect(feat!.filePath).toContain('story.md')
  })

  it('getBody() returns the on-disk body for an item', async () => {
    await makeStory(tmp, 'beta',
      '---\nid: "beta"\nstatus: "todo"\npriority: "low"\n---\n# Beta\n\nBody text.\n')
    repo = new McpFeatureRepository(tmp)
    await repo.load()
    const body = await repo.getBody('native:beta')
    expect(body).toMatch(/# Beta/)
    expect(body).toMatch(/Body text\./)
  })

  it('emits onDidChange after load()', async () => {
    await makeStory(tmp, 'gamma',
      '---\nid: "gamma"\nstatus: "backlog"\npriority: "low"\n---\n# Gamma\n')
    repo = new McpFeatureRepository(tmp)
    const handler = vi.fn()
    repo.onDidChange(handler)
    await repo.load()
    expect(handler).toHaveBeenCalled()
  })

  it('excludes items whose status does not map to a board column', async () => {
    // `draft` is not a column id and is not a known alias; the item should
    // be silently dropped from the board rather than coerced into Backlog.
    await makeStory(tmp, 'visible', '---\nid: "visible"\nstatus: "todo"\n---\n# Visible\n')
    await makeStory(tmp, 'drafty',  '---\nid: "drafty"\nstatus: "draft"\n---\n# Drafty\n')
    await makeStory(tmp, 'deferred', '---\nid: "deferred"\nstatus: "deferred"\n---\n# Deferred\n')
    repo = new McpFeatureRepository(tmp)
    await repo.load()
    expect(repo.features.some(f => f.id === 'native:visible')).toBe(true)
    expect(repo.features.some(f => f.id === 'native:drafty')).toBe(false)
    expect(repo.features.some(f => f.id === 'native:deferred')).toBe(false)
  })

  it('keeps known aliases blocked->todo and cancelled->done', async () => {
    await makeStory(tmp, 'b', '---\nid: "b"\nstatus: "blocked"\n---\n# B\n')
    await makeStory(tmp, 'c', '---\nid: "c"\nstatus: "cancelled"\n---\n# C\n')
    repo = new McpFeatureRepository(tmp)
    await repo.load()
    expect(repo.features.find(f => f.id === 'native:b')?.status).toBe('todo')
    expect(repo.features.find(f => f.id === 'native:c')?.status).toBe('done')
  })
})

describe('McpFeatureRepository — writes', () => {
  let tmp: string
  let repo: McpFeatureRepository

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mcp-repo-w-'))
  })

  afterEach(async () => {
    repo?.dispose()
    await rm(tmp, { recursive: true, force: true })
  })

  it('createFeature writes a new story.md and emits change', async () => {
    repo = new McpFeatureRepository(tmp)
    await repo.load()
    const handler = vi.fn()
    repo.onDidChange(handler)
    const created = await repo.createFeature({
      status: 'todo',
      priority: 'high',
      content: '# Brand new story\n\nWith a body.\n',
      assignee: 'alice',
      epic: null,
      dueDate: '2026-12-01',
      labels: ['frontend'],
    })
    expect(created.id).toMatch(/^native:/)
    expect(created.status).toBe('todo')
    expect(handler).toHaveBeenCalled()
    expect(repo.features.find(f => f.id === created.id)).toBeDefined()
  })

  it('updateFeature patches frontmatter and (when content set) the body', async () => {
    await makeStory(tmp, 'up',
      '---\nid: "up"\nstatus: "todo"\npriority: "low"\n---\n# Up\n\nold body\n')
    repo = new McpFeatureRepository(tmp)
    await repo.load()
    await repo.updateFeature('native:up', {
      priority: 'high',
      assignee: 'bob',
      content: '# Up\n\nnew body\n',
    })
    await repo.load()
    const feat = repo.features.find(f => f.id === 'native:up')!
    expect(feat.priority).toBe('high')
    expect(feat.assignee).toBe('bob')
    const body = await repo.getBody('native:up')
    expect(body).toMatch(/new body/)
  })

  it('moveFeature persists status and order in a single update', async () => {
    await makeStory(tmp, 'mv',
      '---\nid: "mv"\nstatus: "todo"\npriority: "low"\norder: "a0"\n---\n# Mv\n')
    repo = new McpFeatureRepository(tmp)
    await repo.load()
    await repo.moveFeature('native:mv', 'in-progress', 'b1' as unknown as number)
    await repo.load()
    const feat = repo.features.find(f => f.id === 'native:mv')!
    expect(feat.status).toBe('in-progress')
    expect(feat.order).toBe('b1')
  })

  it('deleteFeature removes the folder', async () => {
    await makeStory(tmp, 'gone',
      '---\nid: "gone"\nstatus: "todo"\npriority: "low"\n---\n# Gone\n')
    repo = new McpFeatureRepository(tmp)
    await repo.load()
    await repo.deleteFeature('native:gone')
    await repo.load()
    expect(repo.features.find(f => f.id === 'native:gone')).toBeUndefined()
  })
})

describe('McpFeatureRepository — bulk', () => {
  let tmp: string
  let repo: McpFeatureRepository

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mcp-repo-b-'))
  })

  afterEach(async () => {
    repo?.dispose()
    await rm(tmp, { recursive: true, force: true })
  })

  it('moveAllFeatures moves every item in the source column', async () => {
    await makeStory(tmp, 'a', '---\nid: "a"\nstatus: "todo"\npriority: "low"\n---\n# A\n')
    await makeStory(tmp, 'b', '---\nid: "b"\nstatus: "todo"\npriority: "low"\n---\n# B\n')
    await makeStory(tmp, 'c', '---\nid: "c"\nstatus: "review"\npriority: "low"\n---\n# C\n')
    repo = new McpFeatureRepository(tmp)
    await repo.load()
    await repo.moveAllFeatures('todo', 'in-progress')
    await repo.load()
    expect(repo.features.find(f => f.id === 'native:a')!.status).toBe('in-progress')
    expect(repo.features.find(f => f.id === 'native:b')!.status).toBe('in-progress')
    expect(repo.features.find(f => f.id === 'native:c')!.status).toBe('review')
  })

  it('archiveFeatures sets status=done on every item in the source column', async () => {
    await makeStory(tmp, 'x', '---\nid: "x"\nstatus: "review"\npriority: "low"\n---\n# X\n')
    repo = new McpFeatureRepository(tmp)
    await repo.load()
    const { failedCount } = await repo.archiveFeatures('review')
    expect(failedCount).toBe(0)
    await repo.load()
    expect(repo.features.find(f => f.id === 'native:x')!.status).toBe('done')
  })

  it('renameLabel rewrites labels arrays', async () => {
    await makeStory(tmp, 'lbl',
      '---\nid: "lbl"\nstatus: "todo"\npriority: "low"\nlabels:\n  - "old"\n  - "keep"\n---\n# L\n')
    repo = new McpFeatureRepository(tmp)
    await repo.load()
    const renamed = await repo.renameLabel('old', 'new')
    expect(renamed).toBe(1)
    await repo.load()
    expect(repo.features.find(f => f.id === 'native:lbl')!.labels).toEqual(['new', 'keep'])
  })

  it('deleteLabel removes the label from items', async () => {
    await makeStory(tmp, 'dl',
      '---\nid: "dl"\nstatus: "todo"\npriority: "low"\nlabels:\n  - "drop"\n  - "keep"\n---\n# D\n')
    repo = new McpFeatureRepository(tmp)
    await repo.load()
    await repo.deleteLabel('drop')
    await repo.load()
    expect(repo.features.find(f => f.id === 'native:dl')!.labels).toEqual(['keep'])
  })
})
