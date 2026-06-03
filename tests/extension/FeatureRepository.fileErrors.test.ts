/**
 * Tests that FeatureRepository surfaces filesystem write failures to the user
 * instead of silently swallowing them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as vscode from 'vscode'

// ---------------------------------------------------------------------------
// Hoist shared mocks
// ---------------------------------------------------------------------------
const { mockShowErrorMessage, mockShowWarningMessage } = vi.hoisted(() => ({
  mockShowErrorMessage: vi.fn(),
  mockShowWarningMessage: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock vscode before any other imports
// ---------------------------------------------------------------------------
vi.mock('vscode', () => ({
  window: {
    showErrorMessage: mockShowErrorMessage,
    showWarningMessage: mockShowWarningMessage,
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    getConfiguration: vi.fn(() => ({
      get: (key: string, def: unknown) =>
        key === 'featuresDirectory' ? '.kanban/features' : def,
    })),
    createFileSystemWatcher: vi.fn(() => ({
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
      onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    })),
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
  RelativePattern: class { constructor(public base: unknown, public pattern: string) {} },
}))

vi.mock('fs')

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import { FeatureRepository } from '../../src/extension/FeatureRepository'
import type { FsAdapter } from '../../src/extension/featureFileUtils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FEATURES_DIR = '/workspace/.kanban/features'

function makeContext() {
  return {
    extensionUri: { fsPath: '/ext' },
    workspaceState: {
      get: vi.fn((_k: string, def: unknown) => def),
      update: vi.fn(() => Promise.resolve()),
    },
    subscriptions: [],
  } as unknown as import('vscode').ExtensionContext
}

function makeFeatureMd(overrides: Record<string, unknown> = {}) {
  const id = (overrides.id as string) ?? 'test-feature'
  const status = (overrides.status as string) ?? 'backlog'
  const labels = JSON.stringify((overrides.labels as string[]) ?? [])
  const order = (overrides.order as string) ?? 'a0'
  return [
    '---',
    `id: "${id}"`,
    `status: "${status}"`,
    'priority: "medium"',
    'assignee: null',
    'epic: null',
    'dueDate: null',
    'created: "2026-01-01T00:00:00.000Z"',
    'modified: "2026-01-01T00:00:00.000Z"',
    'completedAt: null',
    `labels: ${labels}`,
    `order: "${order}"`,
    '---',
    '',
    '# Test Feature',
  ].join('\n')
}

class MemoryFs {
  private _files = new Map<string, Uint8Array>()
  writeFileSpy = vi.fn()

  write(fsPath: string, content: string) {
    this._files.set(fsPath, new TextEncoder().encode(content))
  }

  async stat(uri: { fsPath: string }) {
    if (this._files.has(uri.fsPath))
      return { type: 1, ctime: 0, mtime: 0, size: 0 } as vscode.FileStat
    throw Object.assign(new Error(`ENOENT: ${uri.fsPath}`), { code: 'FileNotFound' })
  }
  async rename(src: { fsPath: string }, tgt: { fsPath: string }) {
    const c = this._files.get(src.fsPath)
    if (c !== undefined) {
      this._files.set(tgt.fsPath, c)
      this._files.delete(src.fsPath)
    }
  }
  async createDirectory(_uri: { fsPath: string }) {}
  async readFile(uri: { fsPath: string }) {
    const c = this._files.get(uri.fsPath)
    if (!c) throw Object.assign(new Error(`ENOENT: ${uri.fsPath}`), { code: 'FileNotFound' })
    return c
  }
  async writeFile(uri: { fsPath: string }, content: Uint8Array) {
    await this.writeFileSpy(uri, content)
    this._files.set(uri.fsPath, content)
  }
  async readDirectory(uri: { fsPath: string }): Promise<[string, number][]> {
    const prefix = uri.fsPath.replace(/\/?$/, '/')
    const result: [string, number][] = []
    for (const [p] of this._files) {
      if (p.startsWith(prefix)) {
        const rest = p.slice(prefix.length)
        if (!rest.includes('/')) result.push([rest, 1])
      }
    }
    return result
  }
  async delete(uri: { fsPath: string }) {
    this._files.delete(uri.fsPath)
  }
}

async function makeRepo(files: Record<string, string> = {}) {
  const memFs = new MemoryFs()
  for (const [p, content] of Object.entries(files)) {
    memFs.write(p, content)
  }
  const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
  await repo.load()
  return { repo, memFs }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FeatureRepository file error surfacing', () => {
  it('shows error when writeFile fails in createFeature', async () => {
    const { repo, memFs } = await makeRepo()
    memFs.writeFileSpy.mockRejectedValueOnce(new Error('disk full'))

    await expect(
      repo.createFeature({
        status: 'backlog',
        priority: 'medium',
        content: '# New Card',
        assignee: null,
        epic: null,
        dueDate: null,
        labels: [],
      })
    ).rejects.toThrow()

    expect(mockShowErrorMessage).toHaveBeenCalledOnce()
    expect(mockShowErrorMessage.mock.calls[0][0]).toBe('panel.createFailed')
  })

  it('shows error and reloads when writeFile fails in moveFeature', async () => {
    const { repo, memFs } = await makeRepo({
      [`${FEATURES_DIR}/feat-1.md`]: makeFeatureMd({ id: 'feat-1', status: 'backlog' }),
    })
    memFs.writeFileSpy.mockRejectedValueOnce(new Error('permission denied'))

    await repo.moveFeature('feat-1', 'todo', 0)

    expect(mockShowErrorMessage).toHaveBeenCalledOnce()
    expect(mockShowErrorMessage.mock.calls[0][0]).toBe('panel.moveFailed')
  })

  it('shows error and reloads when writeFile fails in updateFeature', async () => {
    const { repo, memFs } = await makeRepo({
      [`${FEATURES_DIR}/feat-1.md`]: makeFeatureMd({ id: 'feat-1' }),
    })
    memFs.writeFileSpy.mockRejectedValueOnce(new Error('read-only filesystem'))

    await repo.updateFeature('feat-1', { priority: 'high' })

    expect(mockShowErrorMessage).toHaveBeenCalledOnce()
    expect(mockShowErrorMessage.mock.calls[0][0]).toBe('panel.saveFailed')
  })

  it('shows warning with singular message when one writeFile fails in moveAllFeatures', async () => {
    const { repo, memFs } = await makeRepo({
      [`${FEATURES_DIR}/feat-1.md`]: makeFeatureMd({ id: 'feat-1', status: 'backlog', order: 'a0' }),
    })
    memFs.writeFileSpy.mockRejectedValueOnce(new Error('disk full'))

    await repo.moveAllFeatures('backlog', 'todo')

    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
    expect(mockShowWarningMessage.mock.calls[0][0]).toBe('panel.moveAllFailedOne')
  })

  it('shows warning with plural message when multiple writeFiles fail in moveAllFeatures', async () => {
    const { repo, memFs } = await makeRepo({
      [`${FEATURES_DIR}/feat-1.md`]: makeFeatureMd({ id: 'feat-1', status: 'backlog', order: 'a0' }),
      [`${FEATURES_DIR}/feat-2.md`]: makeFeatureMd({ id: 'feat-2', status: 'backlog', order: 'a1' }),
    })
    memFs.writeFileSpy.mockRejectedValue(new Error('disk full'))

    await repo.moveAllFeatures('backlog', 'todo')

    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
    expect(mockShowWarningMessage.mock.calls[0][0]).toBe('panel.moveAllFailedOther')
  })

  it('shows warning with singular message when one writeFile fails in renameLabel', async () => {
    const { repo, memFs } = await makeRepo({
      [`${FEATURES_DIR}/feat-1.md`]: makeFeatureMd({ id: 'feat-1', labels: ['bug'] }),
    })
    memFs.writeFileSpy.mockRejectedValueOnce(new Error('disk full'))

    await repo.renameLabel('bug', 'defect')

    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
    expect(mockShowWarningMessage.mock.calls[0][0]).toBe('panel.renameLabelFailedOne')
  })

  it('shows warning with plural message when multiple writeFiles fail in renameLabel', async () => {
    const { repo, memFs } = await makeRepo({
      [`${FEATURES_DIR}/feat-1.md`]: makeFeatureMd({ id: 'feat-1', labels: ['bug'] }),
      [`${FEATURES_DIR}/feat-2.md`]: makeFeatureMd({ id: 'feat-2', labels: ['bug'] }),
    })
    memFs.writeFileSpy.mockRejectedValue(new Error('disk full'))

    await repo.renameLabel('bug', 'defect')

    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
    expect(mockShowWarningMessage.mock.calls[0][0]).toBe('panel.renameLabelFailedOther')
  })

  it('shows warning with singular message when one writeFile fails in deleteLabel', async () => {
    const { repo, memFs } = await makeRepo({
      [`${FEATURES_DIR}/feat-1.md`]: makeFeatureMd({ id: 'feat-1', labels: ['obsolete'] }),
    })
    memFs.writeFileSpy.mockRejectedValueOnce(new Error('disk full'))

    await repo.deleteLabel('obsolete')

    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
    expect(mockShowWarningMessage.mock.calls[0][0]).toBe('panel.deleteLabelFailedOne')
  })

  it('shows warning with plural message when multiple writeFiles fail in deleteLabel', async () => {
    const { repo, memFs } = await makeRepo({
      [`${FEATURES_DIR}/feat-1.md`]: makeFeatureMd({ id: 'feat-1', labels: ['obsolete'] }),
      [`${FEATURES_DIR}/feat-2.md`]: makeFeatureMd({ id: 'feat-2', labels: ['obsolete'] }),
    })
    memFs.writeFileSpy.mockRejectedValue(new Error('disk full'))

    await repo.deleteLabel('obsolete')

    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
    expect(mockShowWarningMessage.mock.calls[0][0]).toBe('panel.deleteLabelFailedOther')
  })

  it('shows error and clears features when load() fails', async () => {
    const memFs = new MemoryFs()
    memFs.writeFileSpy.mockRejectedValue(new Error('disk full'))
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)

    // Make createDirectory throw to trigger the catch in load()
    const originalCreateDir = memFs.createDirectory.bind(memFs)
    vi.spyOn(memFs, 'createDirectory').mockRejectedValueOnce(new Error('access denied'))

    await repo.load()

    expect(mockShowErrorMessage).toHaveBeenCalledOnce()
    expect(mockShowErrorMessage.mock.calls[0][0]).toBe('panel.loadFailed')
    expect(repo.features).toHaveLength(0)

    vi.mocked(memFs.createDirectory).mockImplementation(originalCreateDir)
  })
})
