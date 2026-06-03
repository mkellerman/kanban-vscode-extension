import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import type * as vscode from 'vscode'

// ---------------------------------------------------------------------------
// Capture watcher callbacks so tests can simulate file-system events
// ---------------------------------------------------------------------------
const { mockCreateFileSystemWatcher, simulateChange } = vi.hoisted(() => {
  const changeCbs: ((uri: { fsPath: string }) => void)[] = []
  const mockWatcher = {
    onDidChange: vi.fn((cb: (uri: { fsPath: string }) => void) => {
      changeCbs.push(cb)
      return { dispose: vi.fn() }
    }),
    onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn()
  }
  const mockCreateFileSystemWatcher = vi.fn(() => mockWatcher)
  const simulateChange = (fsPath: string) => changeCbs.forEach(cb => cb({ fsPath }))
  return { mockCreateFileSystemWatcher, simulateChange }
})

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    getConfiguration: vi.fn(() => ({
      get: (key: string, def: unknown) =>
        key === 'featuresDirectory' ? '.kanban/features' : def
    })),
    createFileSystemWatcher: mockCreateFileSystemWatcher
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
  Uri: { file: (p: string) => ({ fsPath: p }) },
  FileType: { File: 1, Directory: 2, SymbolicLink: 64, Unknown: 0 },
  RelativePattern: class { constructor(public base: unknown, public pattern: string) {} }
}))

vi.mock('fs')

// ---------------------------------------------------------------------------
// In-memory FsAdapter
// ---------------------------------------------------------------------------
const FEATURES_DIR = '/workspace/.kanban/features'

class MemoryFs {
  private _files = new Map<string, Uint8Array>()

  write(fsPath: string, content: string) {
    this._files.set(fsPath, new TextEncoder().encode(content))
  }
  read(fsPath: string): string | undefined {
    const b = this._files.get(fsPath)
    return b ? new TextDecoder().decode(b) : undefined
  }
  has(fsPath: string) { return this._files.has(fsPath) }
  list() { return [...this._files.keys()] }

  async stat(uri: { fsPath: string }) {
    if (this._files.has(uri.fsPath)) return { type: 1, ctime: 0, mtime: 0, size: 0 } as vscode.FileStat
    throw Object.assign(new Error(`ENOENT: ${uri.fsPath}`), { code: 'FileNotFound' })
  }
  async rename(src: { fsPath: string }, tgt: { fsPath: string }) {
    const c = this._files.get(src.fsPath)
    if (c !== undefined) { this._files.set(tgt.fsPath, c); this._files.delete(src.fsPath) }
  }
  async createDirectory(_uri: { fsPath: string }) {}
  async readFile(uri: { fsPath: string }) {
    const c = this._files.get(uri.fsPath)
    if (!c) throw Object.assign(new Error(`ENOENT: ${uri.fsPath}`), { code: 'FileNotFound' })
    return c
  }
  async writeFile(uri: { fsPath: string }, content: Uint8Array) {
    this._files.set(uri.fsPath, content)
  }
  async readDirectory(uri: { fsPath: string }): Promise<[string, number][]> {
    const prefix = uri.fsPath.replace(/\/?$/, '/')
    const result: [string, number][] = []
    for (const [p] of this._files) {
      if (p.startsWith(prefix)) {
        const rest = p.slice(prefix.length)
        if (!rest.includes('/')) result.push([rest, 1]) // FileType.File
      }
    }
    return result
  }
  async delete(uri: { fsPath: string }) { this._files.delete(uri.fsPath) }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext() {
  return {
    extensionUri: { fsPath: '/ext' },
    workspaceState: {
      get: vi.fn((_k: string, def: unknown) => def),
      update: vi.fn(() => Promise.resolve())
    },
    subscriptions: []
  } as unknown as import('vscode').ExtensionContext
}

function makeFeatureMd(overrides: Partial<{
  id: string; status: string; priority: string; order: string; content: string
}> = {}) {
  const id = overrides.id ?? 'my-feat'
  const status = overrides.status ?? 'backlog'
  const priority = overrides.priority ?? 'medium'
  const order = overrides.order ?? 'a0'
  const content = overrides.content ?? `# My Feature\n\nDescription.`
  return [
    '---',
    `id: "${id}"`,
    `status: "${status}"`,
    `priority: "${priority}"`,
    'assignee: null',
    'epic: null',
    'dueDate: null',
    'created: "2026-01-01T00:00:00.000Z"',
    'modified: "2026-01-01T00:00:00.000Z"',
    'completedAt: null',
    'labels: []',
    `order: "${order}"`,
    '---',
    '',
    content
  ].join('\n')
}

import { FeatureRepository } from '../../src/extension/FeatureRepository'
import type { FsAdapter } from '../../src/extension/featureFileUtils'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FeatureRepository.getFeaturesDir()', () => {
  it('returns the workspace + config-derived path', () => {
    const repo = new FeatureRepository(makeContext())
    expect(repo.getFeaturesDir()).toBe(path.join('/workspace', '.kanban/features'))
  })
})

describe('FeatureRepository.load() — Phase 2: reads root and done/ files', () => {
  let memFs: MemoryFs

  beforeEach(() => {
    memFs = new MemoryFs()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads a single root-level feature file', async () => {
    memFs.write(`${FEATURES_DIR}/feat-a.md`, makeFeatureMd({ id: 'feat-a' }))
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    expect(repo.features).toHaveLength(1)
    expect(repo.features[0].id).toBe('feat-a')
  })

  it('loads feature files from done/ subfolder', async () => {
    memFs.write(`${FEATURES_DIR}/done/feat-b.md`, makeFeatureMd({ id: 'feat-b', status: 'done' }))
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    expect(repo.features).toHaveLength(1)
    expect(repo.features[0].id).toBe('feat-b')
    expect(repo.features[0].status).toBe('done')
  })

  it('loads both root and done/ features together', async () => {
    memFs.write(`${FEATURES_DIR}/feat-a.md`, makeFeatureMd({ id: 'feat-a', order: 'a0' }))
    memFs.write(`${FEATURES_DIR}/done/feat-b.md`, makeFeatureMd({ id: 'feat-b', status: 'done', order: 'a1' }))
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    expect(repo.features).toHaveLength(2)
  })

  it('fires onDidChange after load()', async () => {
    memFs.write(`${FEATURES_DIR}/feat-a.md`, makeFeatureMd({ id: 'feat-a' }))
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    const listener = vi.fn()
    repo.onDidChange(listener)
    await repo.load()
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0]).toHaveLength(1)
  })

  it('migrates legacy integer order values to fractional indices', async () => {
    // Use numeric order strings — the repo must migrate them to fractional keys
    memFs.write(`${FEATURES_DIR}/feat-1.md`, makeFeatureMd({ id: 'feat-1', order: '0' }))
    memFs.write(`${FEATURES_DIR}/feat-2.md`, makeFeatureMd({ id: 'feat-2', order: '1' }))
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    expect(repo.features.every(f => !/^\d+$/.test(f.order))).toBe(true)
  })

  it('sorts features by order field', async () => {
    memFs.write(`${FEATURES_DIR}/feat-b.md`, makeFeatureMd({ id: 'feat-b', order: 'a1' }))
    memFs.write(`${FEATURES_DIR}/feat-a.md`, makeFeatureMd({ id: 'feat-a', order: 'a0' }))
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    expect(repo.features[0].id).toBe('feat-a')
    expect(repo.features[1].id).toBe('feat-b')
  })
})

// ---------------------------------------------------------------------------
// Write methods
// ---------------------------------------------------------------------------

describe('FeatureRepository.createFeature()', () => {
  let memFs: MemoryFs

  beforeEach(() => { memFs = new MemoryFs(); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('writes a new .md file and adds the feature to the in-memory list', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    await repo.createFeature({
      status: 'backlog', priority: 'medium', content: '# New Feature\n\nDesc.',
      assignee: null, epic: null, dueDate: null, labels: []
    })
    expect(repo.features).toHaveLength(1)
    expect(memFs.list().some(p => p.includes(FEATURES_DIR))).toBe(true)
  })

  it('fires onDidChange after createFeature', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    const listener = vi.fn()
    repo.onDidChange(listener)
    listener.mockClear()
    await repo.createFeature({
      status: 'backlog', priority: 'low', content: '# Feat',
      assignee: null, epic: null, dueDate: null, labels: []
    })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('places new feature in done/ when status is "done"', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    await repo.createFeature({
      status: 'done', priority: 'low', content: '# Done Feat',
      assignee: null, epic: null, dueDate: null, labels: []
    })
    const paths = memFs.list()
    expect(paths.some(p => p.includes('/done/'))).toBe(true)
  })
})

describe('FeatureRepository.updateFeature()', () => {
  let memFs: MemoryFs

  beforeEach(async () => {
    memFs = new MemoryFs()
    vi.useFakeTimers()
    memFs.write(`${FEATURES_DIR}/feat-a.md`, makeFeatureMd({ id: 'feat-a', priority: 'low' }))
  })
  afterEach(() => { vi.useRealTimers() })

  it('updates priority in memory and on disk', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    await repo.updateFeature('feat-a', { priority: 'high' })
    expect(repo.features[0].priority).toBe('high')
    expect(memFs.read(`${FEATURES_DIR}/feat-a.md`)).toContain('priority: "high"')
  })

  it('fires onDidChange after updateFeature', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    const listener = vi.fn()
    repo.onDidChange(listener)
    listener.mockClear()
    await repo.updateFeature('feat-a', { priority: 'critical' })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('is a no-op for unknown featureId', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    const listener = vi.fn()
    repo.onDidChange(listener)
    listener.mockClear()
    await repo.updateFeature('does-not-exist', { priority: 'high' })
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('FeatureRepository.moveFeature()', () => {
  let memFs: MemoryFs

  beforeEach(async () => {
    memFs = new MemoryFs()
    vi.useFakeTimers()
    memFs.write(`${FEATURES_DIR}/feat-a.md`, makeFeatureMd({ id: 'feat-a', status: 'backlog', order: 'a0' }))
  })
  afterEach(() => { vi.useRealTimers() })

  it('updates status in memory after moveFeature', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    await repo.moveFeature('feat-a', 'in-progress', 0)
    expect(repo.features[0].status).toBe('in-progress')
  })

  it('moves file to done/ when crossing the done boundary', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    await repo.moveFeature('feat-a', 'done', 0)
    expect(memFs.has(`${FEATURES_DIR}/done/feat-a.md`)).toBe(true)
    expect(memFs.has(`${FEATURES_DIR}/feat-a.md`)).toBe(false)
  })

  it('fires onDidChange after moveFeature', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    const listener = vi.fn()
    repo.onDidChange(listener)
    listener.mockClear()
    await repo.moveFeature('feat-a', 'todo', 0)
    expect(listener).toHaveBeenCalledOnce()
  })
})

describe('FeatureRepository.deleteFeature()', () => {
  let memFs: MemoryFs

  beforeEach(async () => {
    memFs = new MemoryFs()
    vi.useFakeTimers()
    memFs.write(`${FEATURES_DIR}/feat-a.md`, makeFeatureMd({ id: 'feat-a' }))
  })
  afterEach(() => { vi.useRealTimers() })

  it('removes feature from memory and deletes the file', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    await repo.deleteFeature('feat-a')
    expect(repo.features).toHaveLength(0)
    expect(memFs.has(`${FEATURES_DIR}/feat-a.md`)).toBe(false)
  })

  it('fires onDidChange after deleteFeature', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    const listener = vi.fn()
    repo.onDidChange(listener)
    listener.mockClear()
    await repo.deleteFeature('feat-a')
    expect(listener).toHaveBeenCalledOnce()
  })
})

describe('FeatureRepository.moveAllFeatures()', () => {
  let memFs: MemoryFs

  beforeEach(async () => {
    memFs = new MemoryFs()
    vi.useFakeTimers()
    memFs.write(`${FEATURES_DIR}/feat-a.md`, makeFeatureMd({ id: 'feat-a', status: 'backlog', order: 'a0' }))
    memFs.write(`${FEATURES_DIR}/feat-b.md`, makeFeatureMd({ id: 'feat-b', status: 'backlog', order: 'a1' }))
  })
  afterEach(() => { vi.useRealTimers() })

  it('moves all features in the source column to the target column', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    await repo.moveAllFeatures('backlog', 'todo')
    expect(repo.features.every(f => f.status === 'todo')).toBe(true)
  })

  it('fires onDidChange after moveAllFeatures', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    const listener = vi.fn()
    repo.onDidChange(listener)
    listener.mockClear()
    await repo.moveAllFeatures('backlog', 'in-progress')
    expect(listener).toHaveBeenCalledOnce()
  })
})

describe('FeatureRepository.archiveFeatures()', () => {
  let memFs: MemoryFs

  beforeEach(async () => {
    memFs = new MemoryFs()
    vi.useFakeTimers()
    memFs.write(`${FEATURES_DIR}/feat-a.md`, makeFeatureMd({ id: 'feat-a', status: 'backlog' }))
    memFs.write(`${FEATURES_DIR}/feat-b.md`, makeFeatureMd({ id: 'feat-b', status: 'todo' }))
  })
  afterEach(() => { vi.useRealTimers() })

  it('moves source column features to archived/ and removes from memory', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    const { failedCount } = await repo.archiveFeatures('backlog')
    expect(failedCount).toBe(0)
    expect(repo.features.every(f => f.status !== 'backlog')).toBe(true)
    expect(memFs.has(`${FEATURES_DIR}/archived/feat-a.md`)).toBe(true)
  })

  it('returns failedCount > 0 when a rename fails', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    // Corrupt the fs adapter to make rename fail for feat-a
    const origRename = memFs.rename.bind(memFs)
    memFs.rename = async (src, tgt) => {
      if (src.fsPath.includes('feat-a')) throw new Error('rename failed')
      return origRename(src, tgt)
    }
    const { failedCount } = await repo.archiveFeatures('backlog')
    expect(failedCount).toBe(1)
  })

  it('fires onDidChange after archiveFeatures', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    await repo.load()
    const listener = vi.fn()
    repo.onDidChange(listener)
    listener.mockClear()
    await repo.archiveFeatures('backlog')
    expect(listener).toHaveBeenCalledOnce()
  })
})
