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
