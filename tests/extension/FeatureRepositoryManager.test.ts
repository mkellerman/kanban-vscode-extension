import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import type * as vscode from 'vscode'

const { mockCreateFileSystemWatcher } = vi.hoisted(() => {
  const mockWatcher = {
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn()
  }
  return { mockCreateFileSystemWatcher: vi.fn(() => mockWatcher) }
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
  extensions: { getExtension: vi.fn(() => undefined) },
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
  window: { showErrorMessage: vi.fn(), showWarningMessage: vi.fn() }
}))

vi.mock('fs')

class MemoryFs {
  private _files = new Map<string, Uint8Array>()
  write(fsPath: string, content: string) { this._files.set(fsPath, new TextEncoder().encode(content)) }
  read(fsPath: string) { const b = this._files.get(fsPath); return b ? new TextDecoder().decode(b) : undefined }
  has(fsPath: string) { return this._files.has(fsPath) }
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
  async writeFile(uri: { fsPath: string }, content: Uint8Array) { this._files.set(uri.fsPath, content) }
  async readDirectory(uri: { fsPath: string }): Promise<[string, number][]> {
    const prefix = uri.fsPath.replace(/\/?$/, '/')
    const result: [string, number][] = []
    const seenDirs = new Set<string>()
    for (const [p] of this._files) {
      if (p.startsWith(prefix)) {
        const rest = p.slice(prefix.length)
        if (!rest.includes('/')) {
          result.push([rest, 1])
        } else {
          const dir = rest.split('/')[0]
          if (!seenDirs.has(dir)) { seenDirs.add(dir); result.push([dir, 2]) }
        }
      }
    }
    return result
  }
  async delete(uri: { fsPath: string }) { this._files.delete(uri.fsPath) }
}

function makeContext() {
  return {
    extensionUri: { fsPath: '/ext' },
    workspaceState: { get: vi.fn((_k: string, def: unknown) => def), update: vi.fn(() => Promise.resolve()) },
    subscriptions: []
  } as unknown as import('vscode').ExtensionContext
}

function makeFeatureMd(id: string, status = 'backlog') {
  return [
    '---', `id: "${id}"`, `status: "${status}"`, `priority: "medium"`,
    'assignee: null', 'epic: null', 'dueDate: null',
    'created: "2026-01-01T00:00:00.000Z"', 'modified: "2026-01-01T00:00:00.000Z"',
    'completedAt: null', 'labels: []', 'order: "a0"', '---', '', `# ${id}`
  ].join('\n')
}

function makeSpMd(id: string, status = 'todo') {
  return [
    '---', `id: "${id}"`, `type: "spec"`, `title: "Spec ${id}"`, `slug: "${id}"`,
    `status: "${status}"`, `priority: "medium"`, 'parent: null',
    'blockedBy: []', 'relatedTo: []', 'labels: []',
    'created: "2026-06-01T00:00:00Z"', 'modified: "2026-06-01T00:00:00Z"',
    '---', '', `# Spec ${id}`
  ].join('\n')
}

import { FeatureRepositoryManager } from '../../src/extension/FeatureRepositoryManager'
import type { FsAdapter } from '../../src/extension/featureFileUtils'

const FEAT_DIR = '/workspace/.kanban/features'
const SP_DIR   = '/workspace/docs/superpowers'

describe('FeatureRepositoryManager', () => {
  let memFs: MemoryFs

  beforeEach(() => { memFs = new MemoryFs(); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('aggregates features from both repos', async () => {
    memFs.write(`${FEAT_DIR}/feat-a.md`, makeFeatureMd('feat-a'))
    memFs.write(`${SP_DIR}/spec-b.md`, makeSpMd('spec-b'))
    const manager = new FeatureRepositoryManager(
      makeContext(),
      [
        { path: '.kanban/features', schema: 'feature' },
        { path: 'docs/superpowers', schema: 'superpowers' }
      ],
      memFs as unknown as FsAdapter
    )
    await manager.load()
    expect(manager.features).toHaveLength(2)
    const ids = manager.features.map(f => f.id).sort()
    expect(ids).toEqual(['feat-a', 'spec-b'])
  })

  it('routes updateFeature to the owning repo', async () => {
    memFs.write(`${SP_DIR}/spec-b.md`, makeSpMd('spec-b'))
    const manager = new FeatureRepositoryManager(
      makeContext(),
      [
        { path: '.kanban/features', schema: 'feature' },
        { path: 'docs/superpowers', schema: 'superpowers' }
      ],
      memFs as unknown as FsAdapter
    )
    await manager.load()
    await manager.updateFeature('spec-b', { status: 'done' })
    const updated = manager.features.find(f => f.id === 'spec-b')
    expect(updated?.status).toBe('done')
    // superpowers file not moved to done/ subdir
    expect(memFs.has(`${SP_DIR}/spec-b.md`)).toBe(true)
    expect(memFs.has(`${SP_DIR}/done/spec-b.md`)).toBe(false)
  })

  it('getFeaturesDir() returns the primary feature-schema repo dir', async () => {
    const manager = new FeatureRepositoryManager(
      makeContext(),
      [
        { path: '.kanban/features', schema: 'feature' },
        { path: 'docs/superpowers', schema: 'superpowers' }
      ],
      memFs as unknown as FsAdapter
    )
    expect(manager.getFeaturesDir()).toBe(path.join('/workspace', '.kanban/features'))
  })

  it('fires onDidChange when either repo changes', async () => {
    memFs.write(`${FEAT_DIR}/feat-a.md`, makeFeatureMd('feat-a'))
    const manager = new FeatureRepositoryManager(
      makeContext(),
      [{ path: '.kanban/features', schema: 'feature' }],
      memFs as unknown as FsAdapter
    )
    const listener = vi.fn()
    manager.onDidChange(listener)
    await manager.load()
    expect(listener).toHaveBeenCalledOnce()
  })

  it('deleteFeature removes from the owning repo', async () => {
    memFs.write(`${FEAT_DIR}/feat-a.md`, makeFeatureMd('feat-a'))
    const manager = new FeatureRepositoryManager(
      makeContext(),
      [{ path: '.kanban/features', schema: 'feature' }],
      memFs as unknown as FsAdapter
    )
    await manager.load()
    expect(manager.features).toHaveLength(1)
    await manager.deleteFeature('feat-a')
    expect(manager.features).toHaveLength(0)
  })

  it('renameLabel broadcasts to all repos', async () => {
    memFs.write(`${FEAT_DIR}/feat-a.md`, makeFeatureMd('feat-a').replace('labels: []', 'labels: ["alpha"]'))
    memFs.write(`${SP_DIR}/spec-b.md`, makeSpMd('spec-b').replace('labels: []', 'labels: ["alpha"]'))
    const manager = new FeatureRepositoryManager(
      makeContext(),
      [
        { path: '.kanban/features', schema: 'feature' },
        { path: 'docs/superpowers', schema: 'superpowers' }
      ],
      memFs as unknown as FsAdapter
    )
    await manager.load()
    const count = await manager.renameLabel('alpha', 'beta')
    expect(count).toBe(2)
    expect(manager.features.every(f => f.labels.includes('beta'))).toBe(true)
  })
})
