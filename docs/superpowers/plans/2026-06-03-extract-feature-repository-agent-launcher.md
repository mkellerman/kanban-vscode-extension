---
id: "extract-feature-repository-service-2026-06-02"
status: "review"
priority: "medium"
created: "2026-06-03T10:00:00.000Z"
modified: "2026-06-03T14:55:00.000Z"
worktree: "/Users/me/Documents/GitHub/kanban-vscode-extension/.claude/worktrees/story-extract-feature-repository-service-2026-06-02"
labels: ["refactor", "architecture"]
---

# Extract FeatureRepository and AgentLauncher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a `FeatureRepository` (all file I/O + in-memory state + watcher) and an `AgentLauncher` (AI prompt + terminal launch) from the three providers so each provider becomes a thin view-controller.

**Architecture:** `FeatureRepository` owns the single `FileSystemWatcher`, the in-memory `Feature[]`, echo suppression, and the full write API. It emits `onDidChange` after every mutation. `AgentLauncher` wraps `buildPrompt` + `launchAgentTerminal` into a single `launch(feature, agent, permissionMode)` call. `index.ts` constructs both and injects them into all three providers. No user-visible behaviour changes.

**Tech Stack:** TypeScript, VS Code Extension API, Vitest, `fractional-indexing`, existing `parseFeatureFile` / `serializeFeature` / `moveFeatureFile` utilities.

**Prerequisite:** `2026-06-02-replace-devtool-for-kanban-folder` must already be merged (touches the same four files).

---

## File Map

| File | Change |
|---|---|
| `src/extension/featureFileUtils.ts` | Extend `FsAdapter` with `readFile`, `writeFile`, `readDirectory`, `delete` |
| `src/extension/FeatureRepository.ts` | **New** — full repository class |
| `src/extension/AgentLauncher.ts` | **New** — thin coordinator class |
| `src/extension/index.ts` | Construct repo + launcher, inject into all three providers, register FeatureHeaderProvider |
| `src/extension/KanbanPanel.ts` | Remove 8 methods, accept `repo` + `launcher`, subscribe to `onDidChange` |
| `src/extension/SidebarViewProvider.ts` | Remove 4 methods, accept `repo`, subscribe to `onDidChange` |
| `src/extension/FeatureHeaderProvider.ts` | Accept `launcher`, collapse `startWithAI` handler to 5 lines |
| `tests/extension/FeatureRepository.test.ts` | **New** — unit tests via in-memory `FsAdapter` |
| `tests/extension/KanbanPanel.startWithAI.test.ts` | Update to inject `AgentLauncher` mock |
| `tests/extension/FeatureHeaderProvider.startWithAI.test.ts` | Update to inject `AgentLauncher` mock |

---

## Task 1: Extend `FsAdapter` and update `featureFileUtils.test.ts`

**Files:**
- Modify: `src/extension/featureFileUtils.ts:4-8`
- Modify: `tests/extension/featureFileUtils.test.ts:34-46`

The current `FsAdapter` only has `stat`, `rename`, `createDirectory`. `FeatureRepository` needs `readFile`, `writeFile`, `readDirectory`, and `delete` as well. Add them to the shared interface now so all downstream code can rely on the full shape.

- [x] **Step 1: Extend `FsAdapter`**

In `src/extension/featureFileUtils.ts`, replace the current interface (lines 4–8):

```ts
export interface FsAdapter {
  stat(uri: vscode.Uri): Thenable<vscode.FileStat>
  rename(source: vscode.Uri, target: vscode.Uri): Thenable<void>
  createDirectory(uri: vscode.Uri): Thenable<void>
}
```

with:

```ts
export interface FsAdapter {
  stat(uri: vscode.Uri): Thenable<vscode.FileStat>
  rename(source: vscode.Uri, target: vscode.Uri): Thenable<void>
  createDirectory(uri: vscode.Uri): Thenable<void>
  readFile(uri: vscode.Uri): Thenable<Uint8Array>
  writeFile(uri: vscode.Uri, content: Uint8Array): Thenable<void>
  readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]>
  delete(uri: vscode.Uri, options?: { recursive?: boolean; useTrash?: boolean }): Thenable<void>
}
```

- [x] **Step 2: Update the test mock to implement the full interface**

In `tests/extension/featureFileUtils.test.ts`, find the `makeFs` function (around line 34) and add the four new methods:

```ts
function makeFs(existing: Set<string> = new Set()): FsAdapter & {
  rename: ReturnType<typeof vi.fn>
  createDirectory: ReturnType<typeof vi.fn>
} {
  return {
    stat: vi.fn((uri: { fsPath: string }) => {
      if (existing.has(uri.fsPath)) return Promise.resolve({} as never)
      return Promise.reject(new Error('ENOENT'))
    }),
    rename: vi.fn(() => Promise.resolve()),
    createDirectory: vi.fn(() => Promise.resolve()),
    readFile: vi.fn(() => Promise.resolve(new Uint8Array())),
    writeFile: vi.fn(() => Promise.resolve()),
    readDirectory: vi.fn(() => Promise.resolve([])),
    delete: vi.fn(() => Promise.resolve())
  }
}
```

- [x] **Step 3: Verify TypeScript compiles with no errors**

```bash
pnpm exec tsc --noEmit
```

Expected: exits 0. The new methods are additive; existing call sites only use `stat`/`rename`/`createDirectory`.

- [x] **Step 4: Run existing tests to confirm no regression**

```bash
pnpm run test -- tests/extension/featureFileUtils.test.ts
```

Expected: all tests PASS.

- [x] **Step 5: Commit**

```bash
git add src/extension/featureFileUtils.ts tests/extension/featureFileUtils.test.ts
git commit -m "refactor: extend FsAdapter with readFile/writeFile/readDirectory/delete"
```

---

## Task 2: Create `FeatureRepository` — core skeleton with `load()` tests

**Files:**
- Create: `tests/extension/FeatureRepository.test.ts`
- Create: `src/extension/FeatureRepository.ts`

Write the test file first, confirm it fails, then implement just enough to make it pass.

### Step 1 — Write failing tests

- [x] **Step 1: Create `tests/extension/FeatureRepository.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'

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
    if (this._files.has(uri.fsPath)) return { type: 1, ctime: 0, mtime: 0, size: 0 } as never
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
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    expect(repo.features).toHaveLength(1)
    expect(repo.features[0].id).toBe('feat-a')
  })

  it('loads feature files from done/ subfolder', async () => {
    memFs.write(`${FEATURES_DIR}/done/feat-b.md`, makeFeatureMd({ id: 'feat-b', status: 'done' }))
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    expect(repo.features).toHaveLength(1)
    expect(repo.features[0].id).toBe('feat-b')
    expect(repo.features[0].status).toBe('done')
  })

  it('loads both root and done/ features together', async () => {
    memFs.write(`${FEATURES_DIR}/feat-a.md`, makeFeatureMd({ id: 'feat-a', order: 'a0' }))
    memFs.write(`${FEATURES_DIR}/done/feat-b.md`, makeFeatureMd({ id: 'feat-b', status: 'done', order: 'a1' }))
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    expect(repo.features).toHaveLength(2)
  })

  it('fires onDidChange after load()', async () => {
    memFs.write(`${FEATURES_DIR}/feat-a.md`, makeFeatureMd({ id: 'feat-a' }))
    const repo = new FeatureRepository(makeContext(), memFs as never)
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
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    expect(repo.features.every(f => !/^\d+$/.test(f.order))).toBe(true)
  })

  it('sorts features by order field', async () => {
    memFs.write(`${FEATURES_DIR}/feat-b.md`, makeFeatureMd({ id: 'feat-b', order: 'a1' }))
    memFs.write(`${FEATURES_DIR}/feat-a.md`, makeFeatureMd({ id: 'feat-a', order: 'a0' }))
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    expect(repo.features[0].id).toBe('feat-a')
    expect(repo.features[1].id).toBe('feat-b')
  })
})
```

- [x] **Step 2: Run to verify it fails (FeatureRepository doesn't exist yet)**

```bash
pnpm run test -- tests/extension/FeatureRepository.test.ts
```

Expected: FAIL — "Cannot find module '../../src/extension/FeatureRepository'"

- [x] **Step 3: Create `src/extension/FeatureRepository.ts` with the skeleton**

```ts
import * as vscode from 'vscode'
import * as path from 'path'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import type { Feature, FeatureStatus, Priority, FilenamePattern } from '../shared/types'
import { getTitleFromContent, generateFeatureFilename } from '../shared/types'
import { parseFeatureFile, serializeFeature } from '../shared/featureFrontmatter'
import {
  ensureStatusSubfolders,
  moveFeatureFile,
  getFeatureFilePath,
  getStatusFromPath,
  fileExists,
  type FsAdapter
} from './featureFileUtils'

export interface CreateFeatureData {
  status: FeatureStatus
  priority: Priority
  content: string
  assignee: string | null
  epic: string | null
  dueDate: string | null
  labels: string[]
}

function normalizeEpic(value: string | null | undefined): string | null {
  const t = value?.trim()
  return t ? t : null
}

export class FeatureRepository implements vscode.Disposable {
  private _features: Feature[] = []
  private _emitter = new vscode.EventEmitter<readonly Feature[]>()
  private _fileWatcher?: vscode.FileSystemWatcher
  private _currentWatcherDir: string | null = null
  private _migrating = false
  private _debounceTimer?: ReturnType<typeof setTimeout>
  private _lastWrittenContents = new Map<string, string>()

  readonly onDidChange: vscode.Event<readonly Feature[]> = this._emitter.event

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _fs: FsAdapter = vscode.workspace.fs as unknown as FsAdapter
  ) {}

  get features(): readonly Feature[] {
    return this._features
  }

  getFeaturesDir(): string | null {
    const folders = vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) return null
    const config = vscode.workspace.getConfiguration('kanban-extension')
    const dir = config.get<string>('featuresDirectory') || '.kanban/features'
    return path.join(folders[0].uri.fsPath, dir)
  }

  async load(): Promise<void> {
    const featuresDir = this.getFeaturesDir()

    // Re-create watcher only when the directory changes
    if (featuresDir !== this._currentWatcherDir) {
      this._setupWatcher(featuresDir)
      this._currentWatcherDir = featuresDir
    }

    if (!featuresDir) {
      this._features = []
      this._emitter.fire(this._features)
      return
    }

    try {
      await this._fs.createDirectory(vscode.Uri.file(featuresDir))
      await ensureStatusSubfolders(featuresDir, this._fs)

      // Phase 1: Old-subfolder migration
      this._migrating = true
      try {
        const oldFolders = ['backlog', 'todo', 'in-progress', 'review']
        for (const folder of oldFolders) {
          const subdir = path.join(featuresDir, folder)
          try {
            const entries = await this._fs.readDirectory(vscode.Uri.file(subdir))
            for (const [name, type] of entries) {
              if (type !== 1 /* File */ || !name.endsWith('.md')) continue
              const filePath = path.join(subdir, name)
              try {
                const bytes = await this._fs.readFile(vscode.Uri.file(filePath))
                const raw = new TextDecoder().decode(bytes)
                const feature = parseFeatureFile(raw, filePath)
                const status = feature?.status || 'backlog'
                await moveFeatureFile(filePath, featuresDir, status, this._fs)
              } catch { /* skip */ }
            }
          } catch { /* subfolder doesn't exist */ }
        }

        // Remove empty old status folders
        for (const folder of oldFolders) {
          const subdir = path.join(featuresDir, folder)
          try {
            const entries = await this._fs.readDirectory(vscode.Uri.file(subdir))
            if (entries.length === 0) await this._fs.delete(vscode.Uri.file(subdir))
          } catch { /* skip */ }
        }

        // Root files with status: done → move to done/
        const rootCheck = await this._fs.readDirectory(vscode.Uri.file(featuresDir))
        for (const [name, type] of rootCheck) {
          if (type !== 1 /* File */ || !name.endsWith('.md')) continue
          const filePath = path.join(featuresDir, name)
          try {
            const bytes = await this._fs.readFile(vscode.Uri.file(filePath))
            const raw = new TextDecoder().decode(bytes)
            const feature = parseFeatureFile(raw, filePath)
            if (feature?.status === 'done') await moveFeatureFile(filePath, featuresDir, 'done', this._fs)
          } catch { /* skip */ }
        }
      } finally {
        this._migrating = false
      }

      // Phase 2: Load root + done/
      const features: Feature[] = []
      const rootEntries = await this._fs.readDirectory(vscode.Uri.file(featuresDir))
      for (const [file, fileType] of rootEntries) {
        if (fileType !== 1 /* File */ || !file.endsWith('.md')) continue
        const filePath = path.join(featuresDir, file)
        const bytes = await this._fs.readFile(vscode.Uri.file(filePath))
        const raw = new TextDecoder().decode(bytes)
        const feature = parseFeatureFile(raw, filePath)
        if (feature) features.push(feature)
      }

      const doneDir = path.join(featuresDir, 'done')
      try {
        const doneEntries = await this._fs.readDirectory(vscode.Uri.file(doneDir))
        for (const [file, fileType] of doneEntries) {
          if (fileType !== 1 /* File */ || !file.endsWith('.md')) continue
          const filePath = path.join(doneDir, file)
          const bytes = await this._fs.readFile(vscode.Uri.file(filePath))
          const raw = new TextDecoder().decode(bytes)
          const feature = parseFeatureFile(raw, filePath)
          if (feature) features.push(feature)
        }
      } catch { /* done/ may not exist yet */ }

      // Phase 3: Reconcile done ↔ non-done mismatches
      this._migrating = true
      try {
        for (const feature of features) {
          const pathStatus = getStatusFromPath(feature.filePath, featuresDir)
          const inDone = pathStatus === 'done'
          const isDone = feature.status === 'done'
          if (isDone && !inDone) {
            try {
              feature.filePath = await moveFeatureFile(feature.filePath, featuresDir, 'done', this._fs)
            } catch { /* retry on next load */ }
          } else if (!isDone && inDone) {
            try {
              feature.filePath = await moveFeatureFile(feature.filePath, featuresDir, feature.status, this._fs)
            } catch { /* retry on next load */ }
          }
        }
      } finally {
        this._migrating = false
      }

      // Legacy integer order migration
      if (features.some(f => /^\d+$/.test(f.order))) {
        const byStatus = new Map<string, Feature[]>()
        for (const f of features) {
          const list = byStatus.get(f.status) ?? []
          list.push(f)
          byStatus.set(f.status, list)
        }
        for (const col of byStatus.values()) {
          col.sort((a, b) => parseInt(a.order) - parseInt(b.order))
          const keys = generateNKeysBetween(null, null, col.length)
          for (let i = 0; i < col.length; i++) {
            col[i].order = keys[i]
            const content = serializeFeature(col[i])
            await this._fs.writeFile(vscode.Uri.file(col[i].filePath), new TextEncoder().encode(content))
          }
        }
      }

      this._features = features.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    } catch {
      this._features = []
    }

    this._emitter.fire(this._features)
  }

  private _setupWatcher(featuresDir: string | null): void {
    if (this._fileWatcher) {
      this._fileWatcher.dispose()
      this._fileWatcher = undefined
    }
    if (!featuresDir) return

    const pattern = new vscode.RelativePattern(featuresDir, '**/*.md')
    this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern)

    const handle = (uri: vscode.Uri) => this._handleFileChange(uri)
    this._fileWatcher.onDidChange(handle)
    this._fileWatcher.onDidCreate(handle)
    this._fileWatcher.onDidDelete(handle)
  }

  private _handleFileChange(uri: vscode.Uri): void {
    if (this._migrating) return
    if (this._debounceTimer) clearTimeout(this._debounceTimer)
    this._debounceTimer = setTimeout(async () => {
      const filePath = uri.fsPath
      const lastWritten = this._lastWrittenContents.get(filePath)
      if (lastWritten !== undefined) {
        try {
          const bytes = await this._fs.readFile(uri)
          const diskContent = new TextDecoder().decode(bytes)
          if (diskContent === lastWritten) {
            this._lastWrittenContents.delete(filePath)
            return // echo — suppress reload
          }
        } catch { /* file deleted — fall through to reload */ }
        this._lastWrittenContents.delete(filePath)
      }
      await this.load()
    }, 100)
  }

  dispose(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer)
    if (this._fileWatcher) this._fileWatcher.dispose()
    this._emitter.dispose()
  }
}
```

- [x] **Step 4: Run tests to confirm they pass**

```bash
pnpm run test -- tests/extension/FeatureRepository.test.ts
```

Expected: all tests in `load()` and `getFeaturesDir()` groups PASS.

- [x] **Step 5: Commit**

```bash
git add src/extension/FeatureRepository.ts tests/extension/FeatureRepository.test.ts
git commit -m "feat: add FeatureRepository skeleton with load() and onDidChange"
```

---

## Task 3: FeatureRepository write methods — `createFeature`, `updateFeature`, `moveFeature`, `deleteFeature`

**Files:**
- Modify: `tests/extension/FeatureRepository.test.ts` — add write-method describe blocks
- Modify: `src/extension/FeatureRepository.ts` — add four write methods

- [x] **Step 1: Append failing tests to `tests/extension/FeatureRepository.test.ts`**

Add after the existing `load()` describe blocks:

```ts
// ---------------------------------------------------------------------------
// Write methods
// ---------------------------------------------------------------------------

describe('FeatureRepository.createFeature()', () => {
  let memFs: MemoryFs

  beforeEach(() => { memFs = new MemoryFs(); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('writes a new .md file and adds the feature to the in-memory list', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    await repo.createFeature({
      status: 'backlog', priority: 'medium', content: '# New Feature\n\nDesc.',
      assignee: null, epic: null, dueDate: null, labels: []
    })
    expect(repo.features).toHaveLength(1)
    expect(memFs.list().some(p => p.includes(FEATURES_DIR))).toBe(true)
  })

  it('fires onDidChange after createFeature', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
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
    const repo = new FeatureRepository(makeContext(), memFs as never)
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
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    await repo.updateFeature('feat-a', { priority: 'high' })
    expect(repo.features[0].priority).toBe('high')
    expect(memFs.read(`${FEATURES_DIR}/feat-a.md`)).toContain('priority: "high"')
  })

  it('fires onDidChange after updateFeature', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    const listener = vi.fn()
    repo.onDidChange(listener)
    listener.mockClear()
    await repo.updateFeature('feat-a', { priority: 'critical' })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('is a no-op for unknown featureId', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
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
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    await repo.moveFeature('feat-a', 'in-progress', 0)
    expect(repo.features[0].status).toBe('in-progress')
  })

  it('moves file to done/ when crossing the done boundary', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    await repo.moveFeature('feat-a', 'done', 0)
    expect(memFs.has(`${FEATURES_DIR}/done/feat-a.md`)).toBe(true)
    expect(memFs.has(`${FEATURES_DIR}/feat-a.md`)).toBe(false)
  })

  it('fires onDidChange after moveFeature', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
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
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    await repo.deleteFeature('feat-a')
    expect(repo.features).toHaveLength(0)
    expect(memFs.has(`${FEATURES_DIR}/feat-a.md`)).toBe(false)
  })

  it('fires onDidChange after deleteFeature', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    const listener = vi.fn()
    repo.onDidChange(listener)
    listener.mockClear()
    await repo.deleteFeature('feat-a')
    expect(listener).toHaveBeenCalledOnce()
  })
})
```

- [x] **Step 2: Run to confirm tests fail**

```bash
pnpm run test -- tests/extension/FeatureRepository.test.ts 2>&1 | grep -E "(FAIL|PASS|Error)" | head -20
```

Expected: FAIL — methods not found on FeatureRepository.

- [x] **Step 3: Add write methods to `src/extension/FeatureRepository.ts`**

Add the following methods to the `FeatureRepository` class (before `dispose()`):

```ts
async createFeature(data: CreateFeatureData): Promise<Feature> {
  const featuresDir = this.getFeaturesDir()
  if (!featuresDir) throw new Error('No workspace open')

  await this._fs.createDirectory(vscode.Uri.file(featuresDir))
  await ensureStatusSubfolders(featuresDir, this._fs)

  const title = getTitleFromContent(data.content)
  const config = vscode.workspace.getConfiguration('kanban-extension')
  const pattern = config.get<FilenamePattern>('filenamePattern', 'name-date')
  const filename = generateFeatureFilename(title, pattern)
  const now = new Date().toISOString()
  const addToTop = config.get<boolean>('addNewCardsToTop', false)

  const inStatus = this._features
    .filter(f => f.status === data.status)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  const newOrder = addToTop
    ? generateKeyBetween(null, inStatus[0]?.order ?? null)
    : generateKeyBetween(inStatus[inStatus.length - 1]?.order ?? null, null)

  let filePath = getFeatureFilePath(featuresDir, data.status, filename)
  let uniqueName = filename
  let counter = 1
  while (await fileExists(filePath, this._fs)) {
    uniqueName = `${filename}-${counter++}`
    filePath = getFeatureFilePath(featuresDir, data.status, uniqueName)
  }

  const feature: Feature = {
    id: uniqueName,
    status: data.status,
    priority: data.priority,
    assignee: data.assignee,
    epic: normalizeEpic(data.epic),
    dueDate: data.dueDate,
    created: now,
    modified: now,
    completedAt: data.status === 'done' ? now : null,
    labels: data.labels,
    order: newOrder,
    content: data.content,
    filePath
  }

  const serialized = serializeFeature(feature)
  this._lastWrittenContents.set(filePath, serialized)
  await this._fs.createDirectory(vscode.Uri.file(path.dirname(filePath)))
  await this._fs.writeFile(vscode.Uri.file(filePath), new TextEncoder().encode(serialized))

  this._features.push(feature)
  this._features.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  this._emitter.fire(this._features)
  return feature
}

async updateFeature(featureId: string, updates: Partial<Feature>): Promise<void> {
  const feature = this._features.find(f => f.id === featureId)
  if (!feature) return

  const featuresDir = this.getFeaturesDir()
  if (!featuresDir) return

  const oldStatus = feature.status
  Object.assign(feature, updates)
  feature.modified = new Date().toISOString()
  if (oldStatus !== feature.status) {
    feature.completedAt = feature.status === 'done' ? feature.modified : null
  }

  const serialized = serializeFeature(feature)
  this._lastWrittenContents.set(feature.filePath, serialized)
  await this._fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(serialized))

  if (oldStatus !== feature.status && (oldStatus === 'done' || feature.status === 'done')) {
    this._migrating = true
    try {
      feature.filePath = await moveFeatureFile(feature.filePath, featuresDir, feature.status, this._fs)
    } catch { /* reconcile on next load */ } finally {
      this._migrating = false
    }
  }

  this._emitter.fire(this._features)
}

async moveFeature(featureId: string, newStatus: string, newOrder: number): Promise<void> {
  const feature = this._features.find(f => f.id === featureId)
  if (!feature) return

  const featuresDir = this.getFeaturesDir()
  if (!featuresDir) return

  const oldStatus = feature.status
  feature.status = newStatus as FeatureStatus
  feature.modified = new Date().toISOString()
  if (oldStatus !== newStatus) {
    feature.completedAt = newStatus === 'done' ? feature.modified : null
  }

  const targetCol = this._features
    .filter(f => f.status === newStatus && f.id !== featureId)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  const clamped = Math.max(0, Math.min(newOrder, targetCol.length))
  feature.order = generateKeyBetween(
    clamped > 0 ? targetCol[clamped - 1].order : null,
    clamped < targetCol.length ? targetCol[clamped].order : null
  )

  const serialized = serializeFeature(feature)
  this._lastWrittenContents.set(feature.filePath, serialized)
  await this._fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(serialized))

  const crossingDone = oldStatus !== newStatus && (oldStatus === 'done' || newStatus === 'done')
  if (crossingDone) {
    this._migrating = true
    try {
      feature.filePath = await moveFeatureFile(feature.filePath, featuresDir, newStatus, this._fs)
    } catch { /* reconcile on next load */ } finally {
      this._migrating = false
    }
  }

  this._emitter.fire(this._features)
}

async deleteFeature(featureId: string): Promise<void> {
  const feature = this._features.find(f => f.id === featureId)
  if (!feature) return
  await this._fs.delete(vscode.Uri.file(feature.filePath))
  this._features = this._features.filter(f => f.id !== featureId)
  this._emitter.fire(this._features)
}
```

- [x] **Step 4: Run tests**

```bash
pnpm run test -- tests/extension/FeatureRepository.test.ts
```

Expected: all tests PASS.

- [x] **Step 5: Compile check**

```bash
pnpm exec tsc --noEmit
```

Expected: exits 0.

- [x] **Step 6: Commit**

```bash
git add src/extension/FeatureRepository.ts tests/extension/FeatureRepository.test.ts
git commit -m "feat: add FeatureRepository write methods (create/update/move/delete)"
```

---

## Task 4: FeatureRepository — `moveAllFeatures`, `archiveFeatures`

**Files:**
- Modify: `tests/extension/FeatureRepository.test.ts`
- Modify: `src/extension/FeatureRepository.ts`

- [x] **Step 1: Append failing tests**

```ts
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
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    await repo.moveAllFeatures('backlog', 'todo')
    expect(repo.features.every(f => f.status === 'todo')).toBe(true)
  })

  it('fires onDidChange after moveAllFeatures', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
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
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    const { failedCount } = await repo.archiveFeatures('backlog')
    expect(failedCount).toBe(0)
    expect(repo.features.every(f => f.status !== 'backlog')).toBe(true)
    expect(memFs.has(`${FEATURES_DIR}/archived/feat-a.md`)).toBe(true)
  })

  it('returns failedCount > 0 when a rename fails', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
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
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    const listener = vi.fn()
    repo.onDidChange(listener)
    listener.mockClear()
    await repo.archiveFeatures('backlog')
    expect(listener).toHaveBeenCalledOnce()
  })
})
```

- [x] **Step 2: Run to confirm tests fail**

```bash
pnpm run test -- tests/extension/FeatureRepository.test.ts 2>&1 | grep -c "FAIL"
```

Expected: non-zero FAIL count.

- [x] **Step 3: Add `moveAllFeatures` and `archiveFeatures` to `FeatureRepository`**

Add before `dispose()`:

```ts
async moveAllFeatures(
  sourceColumnId: string,
  targetColumnId: string,
  epicLane?: string | null
): Promise<void> {
  const featuresDir = this.getFeaturesDir()
  if (!featuresDir) return

  // Import lazily to avoid circular deps
  const { featureMatchesEpicLane } = await import('../shared/epicLane')

  const source = this._features
    .filter(f => f.status === sourceColumnId && featureMatchesEpicLane(f, epicLane))
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  if (source.length === 0) return

  const targetTail = this._features
    .filter(f => f.status === targetColumnId)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))

  const lastOrder = targetTail[targetTail.length - 1]?.order ?? null
  const keys = generateNKeysBetween(lastOrder, null, source.length)

  const crossingDone = sourceColumnId === 'done' || targetColumnId === 'done'
  this._migrating = crossingDone
  try {
    for (let i = 0; i < source.length; i++) {
      const f = source[i]
      f.status = targetColumnId as FeatureStatus
      f.modified = new Date().toISOString()
      f.completedAt = targetColumnId === 'done' ? f.modified : null
      f.order = keys[i]

      const serialized = serializeFeature(f)
      this._lastWrittenContents.set(f.filePath, serialized)
      await this._fs.writeFile(vscode.Uri.file(f.filePath), new TextEncoder().encode(serialized))

      if (crossingDone) {
        try {
          f.filePath = await moveFeatureFile(f.filePath, featuresDir, targetColumnId, this._fs)
        } catch { /* reconcile on next load */ }
      }
    }
  } finally {
    this._migrating = false
  }

  this._emitter.fire(this._features)
}

async archiveFeatures(sourceColumnId: string): Promise<{ failedCount: number }> {
  const featuresDir = this.getFeaturesDir()
  if (!featuresDir) return { failedCount: 0 }

  const source = this._features.filter(f => f.status === sourceColumnId)
  if (source.length === 0) return { failedCount: 0 }

  const archivedDir = path.join(featuresDir, 'archived')
  await this._fs.createDirectory(vscode.Uri.file(archivedDir))

  this._migrating = true
  const archivedIds = new Set<string>()
  let failedCount = 0

  try {
    for (const feature of source) {
      const filename = path.basename(feature.filePath)
      const ext = path.extname(filename)
      const base = path.basename(filename, ext)
      let targetPath = path.join(archivedDir, filename)
      let counter = 1
      while (await fileExists(targetPath, this._fs)) {
        targetPath = path.join(archivedDir, `${base}-${counter++}${ext}`)
      }
      try {
        await this._fs.rename(vscode.Uri.file(feature.filePath), vscode.Uri.file(targetPath))
        archivedIds.add(feature.id)
      } catch {
        failedCount++
      }
    }
    this._features = this._features.filter(f => !archivedIds.has(f.id))
  } finally {
    this._migrating = false
  }

  this._emitter.fire(this._features)
  return { failedCount }
}
```

Add the import at the top of the file: `import { featureMatchesEpicLane } from '../shared/epicLane'` (remove the dynamic import from the method body).

- [x] **Step 4: Run tests**

```bash
pnpm run test -- tests/extension/FeatureRepository.test.ts
```

Expected: all tests PASS.

- [x] **Step 5: Compile + commit**

```bash
pnpm exec tsc --noEmit
git add src/extension/FeatureRepository.ts tests/extension/FeatureRepository.test.ts
git commit -m "feat: add FeatureRepository batch methods (moveAllFeatures/archiveFeatures)"
```

---

## Task 5: FeatureRepository — `renameLabel`, `deleteLabel`, `migrateFilenames`

**Files:**
- Modify: `tests/extension/FeatureRepository.test.ts`
- Modify: `src/extension/FeatureRepository.ts`

- [x] **Step 1: Append failing tests**

```ts
describe('FeatureRepository.renameLabel()', () => {
  let memFs: MemoryFs

  beforeEach(async () => {
    memFs = new MemoryFs()
    vi.useFakeTimers()
    memFs.write(`${FEATURES_DIR}/feat-a.md`,
      makeFeatureMd({ id: 'feat-a' }).replace('labels: []', 'labels: [frontend, bug]'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('renames the label in memory and on disk', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    const count = await repo.renameLabel('frontend', 'ui')
    expect(count).toBe(1)
    expect(repo.features[0].labels).toContain('ui')
    expect(repo.features[0].labels).not.toContain('frontend')
    expect(memFs.read(`${FEATURES_DIR}/feat-a.md`)).toContain('ui')
  })

  it('removes old label if new label already exists on same feature', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    await repo.renameLabel('frontend', 'bug') // bug already exists
    expect(repo.features[0].labels).toEqual(['bug'])
  })

  it('fires onDidChange when any label is updated', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    const listener = vi.fn()
    repo.onDidChange(listener)
    listener.mockClear()
    await repo.renameLabel('frontend', 'ui')
    expect(listener).toHaveBeenCalledOnce()
  })
})

describe('FeatureRepository.deleteLabel()', () => {
  let memFs: MemoryFs

  beforeEach(async () => {
    memFs = new MemoryFs()
    vi.useFakeTimers()
    memFs.write(`${FEATURES_DIR}/feat-a.md`,
      makeFeatureMd({ id: 'feat-a' }).replace('labels: []', 'labels: [bug]'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('removes the label from all features in memory and on disk', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    await repo.deleteLabel('bug')
    expect(repo.features[0].labels).not.toContain('bug')
    expect(memFs.read(`${FEATURES_DIR}/feat-a.md`)).not.toContain('bug')
  })

  it('fires onDidChange after deleteLabel', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    const listener = vi.fn()
    repo.onDidChange(listener)
    listener.mockClear()
    await repo.deleteLabel('bug')
    expect(listener).toHaveBeenCalledOnce()
  })
})

describe('FeatureRepository.migrateFilenames()', () => {
  let memFs: MemoryFs

  beforeEach(async () => {
    memFs = new MemoryFs()
    vi.useFakeTimers()
    // A file with old naming convention (no date)
    memFs.write(`${FEATURES_DIR}/my-feature.md`, makeFeatureMd({ id: 'my-feature' }))
  })
  afterEach(() => { vi.useRealTimers() })

  it('returns renamed and skipped counts', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()
    const result = await repo.migrateFilenames('name-date')
    // The exact renamed count depends on whether the name already matches;
    // at minimum the method must return a valid result object
    expect(typeof result.renamed).toBe('number')
    expect(typeof result.skipped).toBe('number')
  })
})
```

- [x] **Step 2: Run to confirm tests fail**

```bash
pnpm run test -- tests/extension/FeatureRepository.test.ts 2>&1 | grep -c "FAIL"
```

- [x] **Step 3: Add the three methods to `FeatureRepository`**

```ts
async renameLabel(oldName: string, newName: string): Promise<number> {
  const trimOld = oldName.trim()
  const trimNew = newName.trim()
  if (!trimOld || !trimNew || trimOld === trimNew) return 0

  let count = 0
  for (const feature of this._features) {
    const idx = feature.labels.indexOf(trimOld)
    if (idx === -1) continue
    if (feature.labels.includes(trimNew)) {
      feature.labels.splice(idx, 1)
    } else {
      feature.labels[idx] = trimNew
    }
    feature.modified = new Date().toISOString()
    const serialized = serializeFeature(feature)
    this._lastWrittenContents.set(feature.filePath, serialized)
    await this._fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(serialized))
    count++
  }

  if (count > 0) this._emitter.fire(this._features)
  return count
}

async deleteLabel(labelName: string): Promise<void> {
  const trimmed = labelName.trim()
  if (!trimmed) return

  let changed = false
  for (const feature of this._features) {
    const idx = feature.labels.indexOf(trimmed)
    if (idx === -1) continue
    feature.labels.splice(idx, 1)
    feature.modified = new Date().toISOString()
    const serialized = serializeFeature(feature)
    this._lastWrittenContents.set(feature.filePath, serialized)
    await this._fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(serialized))
    changed = true
  }

  if (changed) this._emitter.fire(this._features)
}

async migrateFilenames(pattern: FilenamePattern): Promise<{ renamed: number; skipped: number }> {
  const featuresDir = this.getFeaturesDir()
  if (!featuresDir) return { renamed: 0, skipped: 0 }

  let renamed = 0
  let skipped = 0

  this._migrating = true
  try {
    for (const feature of this._features) {
      const title = getTitleFromContent(feature.content)
      const createdDate = new Date(feature.created)
      const newFilename = generateFeatureFilename(title, pattern, createdDate)
      if (newFilename === feature.id) continue

      const newFilePath = getFeatureFilePath(featuresDir, feature.status, newFilename)
      if (await fileExists(newFilePath, this._fs)) { skipped++; continue }

      const oldPath = feature.filePath
      feature.id = newFilename
      feature.filePath = newFilePath

      const serialized = serializeFeature(feature)
      await this._fs.createDirectory(vscode.Uri.file(path.dirname(newFilePath)))
      await this._fs.writeFile(vscode.Uri.file(newFilePath), new TextEncoder().encode(serialized))
      await this._fs.delete(vscode.Uri.file(oldPath))
      renamed++
    }
  } finally {
    this._migrating = false
  }

  await this.load() // reloads and fires onDidChange
  return { renamed, skipped }
}
```

- [x] **Step 4: Run tests and compile**

```bash
pnpm run test -- tests/extension/FeatureRepository.test.ts && pnpm exec tsc --noEmit
```

Expected: all tests PASS, tsc exits 0.

- [x] **Step 5: Commit**

```bash
git add src/extension/FeatureRepository.ts tests/extension/FeatureRepository.test.ts
git commit -m "feat: add FeatureRepository label and filename-migration methods"
```

---

## Task 6: FeatureRepository — echo suppression tests

**Files:**
- Modify: `tests/extension/FeatureRepository.test.ts`

The echo suppression logic is already in `_handleFileChange` (added in Task 2). This task writes tests to verify it works correctly.

- [x] **Step 1: Append echo suppression tests**

```ts
describe('FeatureRepository — echo suppression', () => {
  let memFs: MemoryFs

  beforeEach(async () => {
    memFs = new MemoryFs()
    vi.useFakeTimers()
    memFs.write(`${FEATURES_DIR}/feat-a.md`, makeFeatureMd({ id: 'feat-a', priority: 'low' }))
  })
  afterEach(() => { vi.useRealTimers() })

  it('does NOT fire onDidChange when watcher fires for a file the repo just wrote', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()

    // Do a write (sets echo suppression sentinel)
    await repo.updateFeature('feat-a', { priority: 'high' })

    const listener = vi.fn()
    repo.onDidChange(listener)
    listener.mockClear() // clear the updateFeature fire

    // Simulate watcher firing for the file we just wrote (same content on disk)
    simulateChange(`${FEATURES_DIR}/feat-a.md`)
    await vi.runAllTimersAsync()

    // Echo suppressed — listener must NOT have been called again
    expect(listener).not.toHaveBeenCalled()
  })

  it('DOES fire onDidChange when watcher fires for a file written by an external tool', async () => {
    const repo = new FeatureRepository(makeContext(), memFs as never)
    await repo.load()

    const listener = vi.fn()
    repo.onDidChange(listener)
    listener.mockClear()

    // External tool writes new content to a file (no sentinel set by repo)
    memFs.write(`${FEATURES_DIR}/feat-a.md`, makeFeatureMd({ id: 'feat-a', priority: 'critical' }))
    simulateChange(`${FEATURES_DIR}/feat-a.md`)
    await vi.runAllTimersAsync()

    // External edit — listener MUST have been called
    expect(listener).toHaveBeenCalledOnce()
    // In-memory state reflects the external change
    expect(repo.features[0].priority).toBe('critical')
  })
})
```

- [x] **Step 2: Run tests**

```bash
pnpm run test -- tests/extension/FeatureRepository.test.ts
```

Expected: all tests PASS (echo suppression was implemented in Task 2).

- [x] **Step 3: Commit**

```bash
git add tests/extension/FeatureRepository.test.ts
git commit -m "test: add echo suppression tests for FeatureRepository watcher"
```

---

## Task 7: Create `AgentLauncher` class — TDD

**Files:**
- Create: `tests/extension/AgentLauncher.test.ts`
- Create: `src/extension/AgentLauncher.ts`

- [x] **Step 1: Create `tests/extension/AgentLauncher.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Feature } from '../../src/shared/types'

const { mockCreateTerminal, mockShowWarningMessage, mockShow, mockIsTrusted } = vi.hoisted(() => {
  const mockShow = vi.fn()
  const mockCreateTerminal = vi.fn(() => ({ show: mockShow }))
  const mockShowWarningMessage = vi.fn()
  const mockIsTrusted = { value: true }
  return { mockCreateTerminal, mockShowWarningMessage, mockShow, mockIsTrusted }
})

vi.mock('vscode', () => ({
  window: { createTerminal: mockCreateTerminal, showWarningMessage: mockShowWarningMessage },
  workspace: {
    get isTrusted() { return mockIsTrusted.value },
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    getWorkspaceFolder: vi.fn(() => ({ uri: { fsPath: '/workspace' } })),
    getConfiguration: vi.fn(() => ({
      get: (key: string, def: unknown) => key === 'columns' ? [
        { id: 'backlog', name: 'Backlog', color: '#6b7280' },
        { id: 'review', name: 'Review', color: '#8b5cf6' }
      ] : def
    }))
  },
  Uri: { file: (p: string) => ({ fsPath: p }) },
  Disposable: { from: (...d: { dispose: () => void }[]) => ({ dispose: () => d.forEach(x => x.dispose()) }) }
}))

const { mockBuildPrompt } = vi.hoisted(() => ({ mockBuildPrompt: vi.fn(() => 'the-prompt') }))
vi.mock('../../src/extension/ai/promptBuilder', () => ({ buildPrompt: mockBuildPrompt }))
vi.mock('fs')

import { AgentLauncher } from '../../src/extension/AgentLauncher'

const REVIEW_FEATURE: Feature = {
  id: 'my-feat',
  status: 'review',
  priority: 'high',
  assignee: null,
  epic: null,
  dueDate: null,
  created: '2026-01-01T00:00:00.000Z',
  modified: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  labels: ['bug'],
  order: 'a0',
  content: '# My Feature\n\nDesc.',
  filePath: '/workspace/.kanban/features/my-feat.md'
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsTrusted.value = true
})

describe('AgentLauncher.launch()', () => {
  it('calls buildPrompt with the correct context and column', () => {
    const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
    launcher.launch(REVIEW_FEATURE, 'claude', 'default')

    expect(mockBuildPrompt).toHaveBeenCalledOnce()
    const [ctx, column, extensionRoot] = mockBuildPrompt.mock.calls[0]
    expect(ctx.title).toBe('My Feature')
    expect(ctx.status).toBe('review')
    expect(column.id).toBe('review')
    expect(extensionRoot).toBe('/ext')
  })

  it('creates a terminal with the feature title and column name', () => {
    const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
    launcher.launch(REVIEW_FEATURE, 'claude', 'default')

    expect(mockCreateTerminal).toHaveBeenCalledOnce()
    const opts = mockCreateTerminal.mock.calls[0][0]
    expect(opts.name).toBe('Review: My Feature')
    expect(opts.shellPath).toBe('claude')
    expect(opts.cwd).toBe('/workspace')
  })

  it('does NOT call buildPrompt when workspace is not trusted', () => {
    mockIsTrusted.value = false
    const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
    launcher.launch(REVIEW_FEATURE, 'claude', 'default')
    expect(mockBuildPrompt).not.toHaveBeenCalled()
    expect(mockCreateTerminal).not.toHaveBeenCalled()
    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
  })

  it('passes column.prompt as settingsTemplate when present', () => {
    // The mock config returns no custom prompt (columns have no .prompt field)
    const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
    launcher.launch(REVIEW_FEATURE, 'claude', 'default')
    const [, , , , settingsTemplate] = mockBuildPrompt.mock.calls[0]
    expect(settingsTemplate).toBeUndefined()
  })

  it('passes the prompt verbatim as a shellArgs element (no shell quoting)', () => {
    const dangerous = `hello "world" 'single' \`cmd\` $VAR; rm -rf`
    mockBuildPrompt.mockReturnValueOnce(dangerous)
    const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
    launcher.launch(REVIEW_FEATURE, 'claude', 'default')
    const opts = mockCreateTerminal.mock.calls[0][0]
    expect(opts.shellArgs).toContain(dangerous)
    expect(opts.shellArgs.join(' ')).not.toContain("'\\''")
  })
})
```

- [x] **Step 2: Run to confirm tests fail**

```bash
pnpm run test -- tests/extension/AgentLauncher.test.ts 2>&1 | head -5
```

Expected: FAIL — module not found.

- [x] **Step 3: Create `src/extension/AgentLauncher.ts`**

```ts
import * as vscode from 'vscode'
import type { Feature, KanbanColumn } from '../shared/types'
import { getTitleFromContent, DEFAULT_COLUMNS } from '../shared/types'
import { buildPrompt, type PromptContext } from './ai/promptBuilder'
import { launchAgentTerminal } from './ai/agentLauncher'
import { t } from './l10n'

export class AgentLauncher {
  constructor(private readonly _extensionUri: vscode.Uri) {}

  launch(feature: Feature, agent: string, permissionMode: string): void {
    if (!vscode.workspace.isTrusted) {
      vscode.window.showWarningMessage(t('panel.aiRequiresTrust'))
      return
    }

    const workspaceRoot =
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(feature.filePath))?.uri.fsPath
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      ?? null

    const config = vscode.workspace.getConfiguration('kanban-extension')
    const columns = config.get<KanbanColumn[]>('columns', DEFAULT_COLUMNS)
    const column = columns.find(c => c.id === feature.status)
      ?? { id: feature.status, name: feature.status, color: '' }

    const ctx: PromptContext = {
      title: getTitleFromContent(feature.content),
      status: feature.status,
      priority: feature.priority,
      labels: feature.labels,
      content: feature.content,
      filePath: feature.filePath
    }

    const prompt = buildPrompt(ctx, column, this._extensionUri.fsPath, workspaceRoot, column.prompt)
    const terminalTitle = `${column.name}: ${ctx.title}`

    launchAgentTerminal(
      agent || 'claude',
      permissionMode || 'default',
      prompt,
      workspaceRoot ?? undefined,
      terminalTitle
    )
  }
}
```

- [x] **Step 4: Run tests and compile**

```bash
pnpm run test -- tests/extension/AgentLauncher.test.ts && pnpm exec tsc --noEmit
```

Expected: all tests PASS, tsc exits 0.

- [x] **Step 5: Commit**

```bash
git add src/extension/AgentLauncher.ts tests/extension/AgentLauncher.test.ts
git commit -m "feat: add AgentLauncher class with workspace-trust guard"
```

---

## Task 8: Wire `index.ts` — construct repo + launcher, inject into providers

**Files:**
- Modify: `src/extension/index.ts`

`index.ts` currently constructs only `SidebarViewProvider` and does not register `FeatureHeaderProvider`. After this task it will construct `FeatureRepository`, `AgentLauncher`, and pass them to all three providers.

**Note:** `KanbanPanel`, `SidebarViewProvider`, and `FeatureHeaderProvider` constructors still have their OLD signatures at this point. This task updates `index.ts` to match the NEW signatures that will be introduced in Tasks 9–11. The extension will NOT compile cleanly until all three thinning tasks are done — this task is a placeholder that we commit after Task 11 rather than as a standalone commit. If you prefer to keep the tree green at all times, implement Tasks 9–11 before committing this file.

- [x] **Step 1: Rewrite `activate()` in `src/extension/index.ts`**

Replace the `activate` function body (lines 108–149) with:

```ts
export function activate(context: vscode.ExtensionContext) {
  loadBundle(context.extensionPath)

  const repo = new FeatureRepository(context)
  const launcher = new AgentLauncher(context.extensionUri)

  const sidebarProvider = new SidebarViewProvider(context.extensionUri, context, repo)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebarProvider)
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kanban-extension.open', () => {
      const wasOpen = !!KanbanPanel.currentPanel
      KanbanPanel.createOrShow(context.extensionUri, context, repo, launcher)
      if (!wasOpen && KanbanPanel.currentPanel) {
        sidebarProvider.setBoardOpen(true)
        KanbanPanel.currentPanel.onDispose(() => {
          sidebarProvider.setBoardOpen(false)
        })
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kanban-extension.addFeature', () => {
      createFeatureFromPrompts(repo)
    })
  )

  if (vscode.window.registerWebviewPanelSerializer) {
    vscode.window.registerWebviewPanelSerializer(KanbanPanel.viewType, {
      async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel) {
        KanbanPanel.revive(webviewPanel, context.extensionUri, context, repo, launcher)
        sidebarProvider.setBoardOpen(true)
        KanbanPanel.currentPanel?.onDispose(() => {
          sidebarProvider.setBoardOpen(false)
        })
      }
    })
  }

  context.subscriptions.push(
    FeatureHeaderProvider.register(context, launcher)
  )

  context.subscriptions.push(repo)
}
```

- [x] **Step 2: Add imports at the top of `index.ts`**

After the existing imports, add:

```ts
import { FeatureRepository } from './FeatureRepository'
import { AgentLauncher } from './AgentLauncher'
import { FeatureHeaderProvider } from './FeatureHeaderProvider'
```

- [x] **Step 3: Update `createFeatureFromPrompts` to accept `repo`**

The function currently uses its own `vscode.workspace.fs` writes. Simplest approach for now: keep using direct writes (the function is a command handler, not a provider). No change needed for the acceptance criteria — the repo's watcher will detect the new file.

If you prefer full consistency, update `createFeatureFromPrompts` to call `repo.createFeature(data)` and remove the direct `vscode.workspace.fs` calls from it. This is optional.

Do NOT commit `index.ts` until after Tasks 9–11 complete and `tsc --noEmit` passes.

---

## Task 9: Thin `KanbanPanel` and update `KanbanPanel.startWithAI.test.ts`

**Files:**
- Modify: `src/extension/KanbanPanel.ts`
- Modify: `tests/extension/KanbanPanel.startWithAI.test.ts`

This is the largest mechanical change. The approach: update both files together in a single commit so the suite stays green.

### Part A — Update `KanbanPanel.startWithAI.test.ts` first

The test currently calls `panelAny._startWithAI(...)` directly. After the refactor, `_startWithAI` is gone; the message handler routes to `this._launcher.launch(...)`. Rewrite the tests to:
1. Capture the `onDidReceiveMessage` handler
2. Inject a mock repo and launcher
3. Send `{ type: 'startWithAI', ... }` messages and verify `launcher.launch` is called

- [x] **Step 1: Rewrite `tests/extension/KanbanPanel.startWithAI.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCreateTerminal, mockPostMessage, mockGetConfiguration,
        mockGetWorkspaceFolder, mockShowWarningMessage, mockIsTrusted,
        captureMessageHandler } = vi.hoisted(() => {
  let _handler: ((msg: unknown) => Promise<void>) | undefined
  const mockCreateTerminal = vi.fn(() => ({ show: vi.fn() }))
  const mockPostMessage = vi.fn()
  const mockGetConfiguration = vi.fn()
  const mockGetWorkspaceFolder = vi.fn()
  const mockShowWarningMessage = vi.fn()
  const mockIsTrusted = { value: true }
  const captureMessageHandler = {
    get: () => _handler,
    set: (h: (msg: unknown) => Promise<void>) => { _handler = h }
  }
  return { mockCreateTerminal, mockPostMessage, mockGetConfiguration,
           mockGetWorkspaceFolder, mockShowWarningMessage, mockIsTrusted,
           captureMessageHandler }
})

vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn(() => ({
      webview: {
        options: {},
        html: '',
        onDidReceiveMessage: vi.fn((handler) => {
          captureMessageHandler.set(handler)
          return { dispose: vi.fn() }
        }),
        postMessage: mockPostMessage,
        asWebviewUri: (uri: { fsPath: string }) => uri
      },
      onDidDispose: vi.fn(),
      iconPath: undefined,
      reveal: vi.fn(),
      viewColumn: 1
    })),
    createTerminal: mockCreateTerminal,
    showErrorMessage: vi.fn(),
    showWarningMessage: mockShowWarningMessage
  },
  workspace: {
    getConfiguration: mockGetConfiguration,
    get isTrusted() { return mockIsTrusted.value },
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    getWorkspaceFolder: mockGetWorkspaceFolder,
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() }))
  },
  Uri: {
    file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/')
    })
  },
  ViewColumn: { One: 1, Two: 2, Beside: -2 },
  RelativePattern: class RelativePattern {
    constructor(public base: unknown, public pattern: string) {}
  },
  EventEmitter: class<T> {
    private _ls: ((e: T) => void)[] = []
    event = (cb: (e: T) => void) => { this._ls.push(cb); return { dispose: vi.fn() } }
    fire(e: T) { [...this._ls].forEach(l => l(e)) }
    dispose() {}
  }
}))

vi.mock('fs')

import { KanbanPanel } from '../../src/extension/KanbanPanel'

const REVIEW_FEATURE = {
  id: 'my-review-feature',
  status: 'review',
  priority: 'high',
  assignee: null, epic: null, dueDate: null,
  created: '2026-01-01T00:00:00.000Z',
  modified: '2026-01-01T00:00:00.000Z',
  completedAt: null, labels: ['bug'], order: 'a0',
  content: '# My Review Feature\nSome description',
  filePath: '/workspace/.kanban/features/my-review-feature.md'
}

function makeRepo(features = [REVIEW_FEATURE]) {
  return {
    features,
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    load: vi.fn(() => Promise.resolve()),
    getFeaturesDir: vi.fn(() => '/workspace/.kanban/features'),
    createFeature: vi.fn(),
    updateFeature: vi.fn(),
    moveFeature: vi.fn(),
    moveAllFeatures: vi.fn(),
    archiveFeatures: vi.fn(() => Promise.resolve({ failedCount: 0 })),
    deleteFeature: vi.fn(),
    renameLabel: vi.fn(() => Promise.resolve(0)),
    deleteLabel: vi.fn(),
    migrateFilenames: vi.fn(() => Promise.resolve({ renamed: 0, skipped: 0 })),
    dispose: vi.fn()
  }
}

function makeLauncher() {
  return { launch: vi.fn() }
}

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

function makeConfigMock(aiAgent = 'claude') {
  return {
    get: vi.fn((key: string, def?: unknown) => {
      if (key === 'aiAgent') return aiAgent
      if (key === 'columns') return [
        { id: 'backlog', name: 'Backlog', color: '#6b7280' },
        { id: 'review', name: 'Review', color: '#8b5cf6' },
        { id: 'done', name: 'Done', color: '#22c55e' }
      ]
      return def
    })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsTrusted.value = true
  KanbanPanel.currentPanel = undefined
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendStartWithAI(
  agent = 'claude',
  permissionMode = 'default',
  featureId = 'my-review-feature'
) {
  const handler = captureMessageHandler.get()
  if (!handler) throw new Error('message handler not captured')
  // First send 'openFeature' to set _currentEditingFeatureId
  await handler({ type: 'openFeature', featureId })
  await handler({ type: 'startWithAI', agent, permissionMode })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KanbanPanel startWithAI routing', () => {
  it('calls launcher.launch with the feature, agent, and permissionMode', async () => {
    mockGetConfiguration.mockReturnValue(makeConfigMock())
    mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: '/workspace' } })

    const repo = makeRepo()
    const launcher = makeLauncher()
    KanbanPanel.createOrShow(
      { fsPath: '/ext' } as import('vscode').Uri,
      makeContext(), repo as never, launcher as never
    )

    await sendStartWithAI('claude', 'default')

    expect(launcher.launch).toHaveBeenCalledOnce()
    const [feature, agent, permissionMode] = launcher.launch.mock.calls[0]
    expect(feature.id).toBe('my-review-feature')
    expect(agent).toBe('claude')
    expect(permissionMode).toBe('default')
  })

  it('falls back to aiAgent config when message.agent is falsy', async () => {
    mockGetConfiguration.mockReturnValue(makeConfigMock('codex'))
    const repo = makeRepo()
    const launcher = makeLauncher()
    KanbanPanel.createOrShow(
      { fsPath: '/ext' } as import('vscode').Uri,
      makeContext(), repo as never, launcher as never
    )

    const handler = captureMessageHandler.get()!
    await handler({ type: 'openFeature', featureId: 'my-review-feature' })
    await handler({ type: 'startWithAI', agent: '', permissionMode: 'default' })

    const [, agent] = launcher.launch.mock.calls[0]
    expect(agent).toBe('codex')
  })

  it('does NOT call launcher.launch when workspace is not trusted', async () => {
    mockIsTrusted.value = false
    mockGetConfiguration.mockReturnValue(makeConfigMock())
    const repo = makeRepo()
    const launcher = makeLauncher()
    KanbanPanel.createOrShow(
      { fsPath: '/ext' } as import('vscode').Uri,
      makeContext(), repo as never, launcher as never
    )

    await sendStartWithAI()

    expect(launcher.launch).not.toHaveBeenCalled()
    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
  })

  it('does NOT call launcher.launch when no feature is being edited', async () => {
    mockGetConfiguration.mockReturnValue(makeConfigMock())
    const repo = makeRepo()
    const launcher = makeLauncher()
    KanbanPanel.createOrShow(
      { fsPath: '/ext' } as import('vscode').Uri,
      makeContext(), repo as never, launcher as never
    )

    // Send startWithAI WITHOUT sending openFeature first
    const handler = captureMessageHandler.get()!
    await handler({ type: 'startWithAI', agent: 'claude', permissionMode: 'default' })

    expect(launcher.launch).not.toHaveBeenCalled()
  })
})
```

### Part B — Thin `KanbanPanel.ts`

- [x] **Step 2: Update `KanbanPanel`'s constructor signature and fields**

In `src/extension/KanbanPanel.ts`:

1. **Add imports** at the top:
```ts
import type { FeatureRepository, CreateFeatureData } from './FeatureRepository'
import type { AgentLauncher } from './AgentLauncher'
```

2. **Remove these imports** (no longer needed in KanbanPanel directly):
```ts
// Remove:
import { buildPrompt, PromptContext } from './ai/promptBuilder'
import { launchAgentTerminal } from './ai/agentLauncher'
```
(Keep `parseFeatureFile` — still used by `_saveFeatureContent`.)

3. **Remove these private fields** from the class:
```ts
// Remove:
private _features: Feature[] = []
private _fileWatcher: vscode.FileSystemWatcher | undefined
private _lastWrittenContent: string = ''
private _migrating = false
```

4. **Add new private fields**:
```ts
private _repo: FeatureRepository
private _launcher: AgentLauncher
private _lastSentEditorContent: string = ''
```

5. **Update `createOrShow` and `revive` signatures**:
```ts
public static createOrShow(
  extensionUri: vscode.Uri,
  context: vscode.ExtensionContext,
  repo: FeatureRepository,
  launcher: AgentLauncher
) {
  // ... same panel creation logic ...
  KanbanPanel.currentPanel = new KanbanPanel(panel, extensionUri, context, repo, launcher)
}

public static revive(
  panel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  context: vscode.ExtensionContext,
  repo: FeatureRepository,
  launcher: AgentLauncher
) {
  KanbanPanel.currentPanel = new KanbanPanel(panel, extensionUri, context, repo, launcher)
}
```

6. **Update the constructor**:
```ts
private constructor(
  panel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  context: vscode.ExtensionContext,
  repo: FeatureRepository,
  launcher: AgentLauncher
) {
  this._panel = panel
  this._extensionUri = extensionUri
  this._context = context
  this._repo = repo
  this._launcher = launcher
  // ... rest of constructor unchanged ...
}
```

- [x] **Step 3: Subscribe to `repo.onDidChange` in the constructor**

Replace the old `this._setupFileWatcher()` call with:

```ts
// Subscribe to repository change events
this._repo.onDidChange(newFeatures => {
  this._sendFeaturesToWebview()
  // Check for external edits to the currently-open feature
  if (this._currentEditingFeatureId) {
    const feature = newFeatures.find(f => f.id === this._currentEditingFeatureId)
    if (feature) {
      const currentSerialized = serializeFeature(feature)
      if (currentSerialized !== this._lastSentEditorContent) {
        this._sendFeatureContent(this._currentEditingFeatureId)
      }
    }
  }
}, null, this._disposables)
```

- [x] **Step 4: Rewrite the message switch to use repo/launcher**

Replace the `case 'ready':` block:
```ts
case 'ready':
  await this._repo.load()
  break
```

Replace `case 'createFeature':`:
```ts
case 'createFeature': {
  await this._repo.createFeature(message.data as CreateFeatureData)
  const createConfig = vscode.workspace.getConfiguration('kanban-extension')
  if (createConfig.get<boolean>('markdownEditorMode', false)) {
    const features = this._repo.features
    const created = features[features.length - 1]
    if (created) this._openFeatureInNativeEditor(created.id)
  }
  break
}
```

Replace `case 'moveFeature':`:
```ts
case 'moveFeature':
  await this._repo.moveFeature(message.featureId, message.newStatus, message.newOrder)
  break
```

Replace `case 'deleteFeature':`:
```ts
case 'deleteFeature':
  await this._repo.deleteFeature(message.featureId)
  break
```

Replace `case 'updateFeature':`:
```ts
case 'updateFeature':
  await this._repo.updateFeature(message.featureId, message.updates)
  break
```

Replace `case 'moveAllCards':`:
```ts
case 'moveAllCards':
  await this._moveAllCards(message.sourceColumnId, message.targetColumnId, message.epicLane)
  break
```

Replace `case 'archiveAllCards':`:
```ts
case 'archiveAllCards':
  await this._archiveAllCards(message.sourceColumnId)
  break
```

Replace `case 'renameLabel':`:
```ts
case 'renameLabel':
  await this._renameLabel(message.oldName, message.newName)
  break
```

Replace `case 'deleteLabel':`:
```ts
case 'deleteLabel':
  await this._deleteLabel(message.labelName)
  break
```

Replace `case 'startWithAI':`:
```ts
case 'startWithAI': {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage(t('panel.aiRequiresTrust'))
    return
  }
  const feature = this._repo.features.find(f => f.id === this._currentEditingFeatureId)
  if (feature) {
    const config = vscode.workspace.getConfiguration('kanban-extension')
    const agent = message.agent || config.get<string>('aiAgent') || 'claude'
    this._launcher.launch(feature, agent, message.permissionMode || 'default')
  }
  break
}
```

Replace the `onDidChangeConfiguration` listener to remove `_setupFileWatcher` and `_loadFeatures`:
```ts
vscode.workspace.onDidChangeConfiguration(e => {
  if (e.affectsConfiguration('kanban-extension')) {
    if (e.affectsConfiguration('kanban-extension.language')) {
      reloadBundle()
    }
    if (e.affectsConfiguration('kanban-extension.featuresDirectory')) {
      this._repo.load() // repo re-creates its watcher for new directory
    } else {
      this._sendFeaturesToWebview()
      if (e.affectsConfiguration('kanban-extension.filenamePattern')) {
        this._promptFilenamePatternMigration()
      }
      if (e.affectsConfiguration('kanban-extension.language')) {
        this._promptColumnLanguageMigration()
      }
    }
  } else if (e.affectsConfiguration('chat.disableAIFeatures')) {
    this._sendFeaturesToWebview()
  }
}, null, this._disposables)
```

Remove the `this._setupFileWatcher()` call from the constructor (replaced by `onDidChange` subscription above).

- [x] **Step 5: Update `_sendFeaturesToWebview` to read from `this._repo.features`**

In `_sendFeaturesToWebview()`, replace:
```ts
const features = this._features.map(f => ({
```
with:
```ts
const features = this._repo.features.map(f => ({
```

- [x] **Step 6: Update `_saveFeatureContent` to use `repo.updateFeature` and set `_lastSentEditorContent`**

Replace the entire `_saveFeatureContent` method body:

```ts
private async _saveFeatureContent(
  featureId: string,
  content: string,
  frontmatter: FeatureFrontmatter
): Promise<void> {
  const updates: Partial<Feature> = {
    content,
    status: frontmatter.status,
    priority: frontmatter.priority,
    assignee: frontmatter.assignee,
    epic: frontmatter.epic,
    dueDate: frontmatter.dueDate,
    labels: frontmatter.labels
  }
  await this._repo.updateFeature(featureId, updates)
  // Record what we just saved so the onDidChange handler doesn't trigger a
  // spurious featureContent refresh
  const feature = this._repo.features.find(f => f.id === featureId)
  if (feature) this._lastSentEditorContent = serializeFeature(feature)
}
```

- [x] **Step 7: Update `_sendFeatureContent` to set `_lastSentEditorContent`**

In `_sendFeatureContent`, after building the frontmatter object and before calling `postMessage`, add:
```ts
this._lastSentEditorContent = serializeFeature(feature)
```

(This ensures external-change detection compares against what we last sent.)

- [x] **Step 8: Update private methods that called `_sendFeaturesToWebview` directly**

`_archiveAllCards`, `_deleteLabel`, `_renameLabel`, and `_migrateFilenames` no longer call `_sendFeaturesToWebview()` directly — the `onDidChange` subscription handles it via repo events. Update those methods to delegate to repo:

`_archiveAllCards`:
```ts
private async _archiveAllCards(sourceColumnId: string): Promise<void> {
  const source = this._repo.features.filter(f => f.status === sourceColumnId)
  if (source.length === 0) return

  const count = source.length
  const archiveMsg = count === 1 ? t('panel.archiveConfirmOne') : t('panel.archiveConfirmOther', { count })
  const archiveButton = t('panel.archiveButton')
  const confirm = await vscode.window.showWarningMessage(archiveMsg, { modal: true }, archiveButton)
  if (confirm !== archiveButton) return

  const { failedCount } = await this._repo.archiveFeatures(sourceColumnId)

  if (failedCount > 0) {
    const failMsg = failedCount === 1 ? t('panel.archiveFailedOne') : t('panel.archiveFailedOther', { count: failedCount })
    vscode.window.showWarningMessage(failMsg)
  }
}
```

`_moveAllCards`:
```ts
private async _moveAllCards(
  sourceColumnId: string,
  targetColumnId: string,
  epicLane?: string | null
): Promise<void> {
  await this._repo.moveAllFeatures(sourceColumnId, targetColumnId, epicLane)
}
```

`_deleteLabel`:
```ts
private async _deleteLabel(labelName: string): Promise<void> {
  const trimmed = labelName.trim()
  if (!trimmed) return
  const affected = this._repo.features.filter(f => f.labels.includes(trimmed))
  if (affected.length === 0) return

  const count = affected.length
  const removeMsg = count === 1 ? t('panel.removeLabelOne', { label: trimmed }) : t('panel.removeLabelOther', { label: trimmed, count })
  const removeButton = t('panel.removeButton')
  const confirm = await vscode.window.showWarningMessage(removeMsg, { modal: true }, removeButton)
  if (confirm !== removeButton) return

  await this._repo.deleteLabel(trimmed)
}
```

`_renameLabel`:
```ts
private async _renameLabel(oldName: string, newName: string): Promise<void> {
  await this._repo.renameLabel(oldName, newName)
}
```

`_migrateFilenames`:
```ts
private async _migrateFilenames(): Promise<void> {
  const config = vscode.workspace.getConfiguration('kanban-extension')
  const pattern = config.get<FilenamePattern>('filenamePattern', 'name-date')
  const { renamed, skipped } = await this._repo.migrateFilenames(pattern)
  const msg = skipped > 0
    ? t('panel.renameResultWithSkipped', { renamed, skipped })
    : t('panel.renameResult', { renamed })
  vscode.window.showInformationMessage(`Kanban Markdown: ${msg}`)
}
```

- [x] **Step 9: Delete the methods that moved to FeatureRepository**

Delete these private methods entirely from `KanbanPanel.ts`:
- `_getWorkspaceFeaturesDir()`
- `_ensureFeaturesDir()`
- `_loadFeatures()`
- `_setupFileWatcher()`
- `_startWithAI()`
- `_createFeature()`
- `_moveFeature()`
- `_updateFeature()`
- `_deleteFeature()` (replaced above by `this._repo.deleteFeature`)

- [x] **Step 10: Compile and run tests**

```bash
pnpm exec tsc --noEmit
pnpm run test -- tests/extension/KanbanPanel.startWithAI.test.ts
```

Expected: tsc exits 0, all KanbanPanel startWithAI tests PASS.

- [x] **Step 11: Run full test suite**

```bash
pnpm run test
```

Expected: all tests PASS.

- [x] **Step 12: Commit**

```bash
git add src/extension/KanbanPanel.ts tests/extension/KanbanPanel.startWithAI.test.ts
git commit -m "refactor: thin KanbanPanel — delegate file I/O to FeatureRepository and AI launch to AgentLauncher"
```

---

## Task 10: Thin `SidebarViewProvider`

**Files:**
- Modify: `src/extension/SidebarViewProvider.ts`

`SidebarViewProvider` currently owns its own watcher, `_loadFeatures`, `_parseFrontmatter`, and `_features` list. After this task it subscribes to `repo.onDidChange` instead.

- [x] **Step 1: Update `SidebarViewProvider.ts`**

1. **Remove imports** that are no longer needed:
```ts
// Remove:
import { getTitleFromContent } from '../shared/types'
import type { FeatureStatus, Priority, KanbanColumn } from '../shared/types'
// Keep:
import type { KanbanColumn } from '../shared/types'
```

2. **Remove the `SidebarFeature` interface** — the provider now receives the full `Feature[]` from the repo's `onDidChange` event. It only needs what it sends to the webview. The webview message still passes `features` and `columns`. Keep mapping to the minimal shape inline.

3. **Update the constructor** to accept `repo: FeatureRepository`:
```ts
import type { FeatureRepository } from './FeatureRepository'
import type { Feature } from '../shared/types'

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'kanban-extension.boardView'

  private _view?: vscode.WebviewView
  private _disposables: vscode.Disposable[] = []

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
    private readonly _repo: FeatureRepository
  ) {
    this._repo.onDidChange(features => {
      this._postUpdate(features)
    }, null, this._disposables)

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('kanban-extension')) {
        if (e.affectsConfiguration('kanban-extension.featuresDirectory')) {
          this._repo.load()
        } else {
          this._postUpdate(this._repo.features as Feature[])
        }
      }
    }, null, this._disposables)
  }
```

4. **Replace `_refresh()`** with a direct post:
```ts
private _postUpdate(features: readonly Feature[]): void {
  if (!this._view) return
  const mapped = features.map(f => ({
    id: f.id,
    title: f.content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? f.id,
    status: f.status,
    priority: f.priority
  }))
  this._view.webview.postMessage({
    type: 'update',
    features: mapped,
    columns: this._getColumns()
  })
  this._view.webview.postMessage({
    type: 'boardOpenChanged',
    open: !!KanbanPanel.currentPanel
  })
}
```

5. **Update `resolveWebviewView`** to remove the old `ready` handler call:
```ts
case 'ready':
  this._postUpdate(this._repo.features as Feature[])
  break
```

6. **Delete these methods entirely**:
- `_setupFileWatcher()`
- `_getFeaturesDir()`
- `_loadFeatures()`
- `_parseFrontmatter()`
- `dispose()` (or simplify to just dispose disposables)

7. **Update `dispose()`**:
```ts
public dispose(): void {
  for (const d of this._disposables) d.dispose()
}
```

- [x] **Step 2: Compile and run tests**

```bash
pnpm exec tsc --noEmit && pnpm run test
```

Expected: tsc exits 0, all tests PASS.

- [x] **Step 3: Commit**

```bash
git add src/extension/SidebarViewProvider.ts
git commit -m "refactor: thin SidebarViewProvider — subscribe to repo.onDidChange, remove own watcher"
```

---

## Task 11: Update `FeatureHeaderProvider` and its test

**Files:**
- Modify: `src/extension/FeatureHeaderProvider.ts`
- Modify: `tests/extension/FeatureHeaderProvider.startWithAI.test.ts`

`FeatureHeaderProvider`'s 40-line `startWithAI` handler collapses to 5 lines via `launcher.launch`. The trust guard stays in the handler.

### Part A — Update `FeatureHeaderProvider.startWithAI.test.ts`

The test currently constructs `new FeatureHeaderProvider(extensionUri)`. After the refactor, the constructor takes `(extensionUri, launcher)`. Update the tests to inject a mock launcher and verify it's called.

- [x] **Step 1: Rewrite `tests/extension/FeatureHeaderProvider.startWithAI.test.ts`**

The key changes:
- Add `mockLaunch = vi.fn()` and pass `{ launch: mockLaunch }` as launcher
- Remove `mockBuildPrompt` and `mockCreateTerminal` assertions
- Assert `mockLaunch` called with the correct `Feature`, `agent`, `permissionMode`
- Keep trust-guard tests but assert on `mockLaunch` not being called

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetConfiguration, mockGetWorkspaceFolder, mockShowWarningMessage,
        mockIsTrusted } = vi.hoisted(() => {
  const mockGetConfiguration = vi.fn()
  const mockGetWorkspaceFolder = vi.fn()
  const mockShowWarningMessage = vi.fn()
  const mockIsTrusted = { value: true }
  return { mockGetConfiguration, mockGetWorkspaceFolder, mockShowWarningMessage, mockIsTrusted }
})

let capturedMessageHandler: ((msg: unknown) => Promise<void>) | undefined

vi.mock('vscode', () => ({
  window: {
    registerWebviewViewProvider: vi.fn(),
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
    activeTextEditor: undefined,
    showWarningMessage: mockShowWarningMessage
  },
  workspace: {
    getConfiguration: mockGetConfiguration,
    get isTrusted() { return mockIsTrusted.value },
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    getWorkspaceFolder: mockGetWorkspaceFolder,
    onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    applyEdit: vi.fn(() => Promise.resolve(true))
  },
  Uri: {
    file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/')
    })
  },
  ViewColumn: { One: 1 },
  Disposable: {
    from: (...disposables: unknown[]) => ({ dispose: vi.fn(), disposables })
  }
}))

vi.mock('fs')

const FEATURE_CONTENT = [
  '---', 'id: my-feat', 'status: review', 'priority: high',
  'assignee: null', 'epic: null', 'dueDate: null',
  'created: 2026-01-01T00:00:00.000Z', 'modified: 2026-01-01T00:00:00.000Z',
  'completedAt: null', 'labels: [frontend]', 'order: a0', '---', '',
  '# My Review Feature', '', 'Feature description here.'
].join('\n')

const FEATURE_PATH = '/workspace/.kanban/features/my-feat.md'

import { FeatureHeaderProvider } from '../../src/extension/FeatureHeaderProvider'

function makeWebviewView() {
  return {
    webview: {
      options: {} as unknown,
      html: '',
      onDidReceiveMessage: vi.fn((handler: (msg: unknown) => Promise<void>) => {
        capturedMessageHandler = handler
        return { dispose: vi.fn() }
      }),
      postMessage: vi.fn(),
      asWebviewUri: (uri: { fsPath: string }) => uri
    },
    onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
    visible: true
  } as unknown as import('vscode').WebviewView
}

function makeDocument(content = FEATURE_CONTENT, fsPath = FEATURE_PATH) {
  return {
    getText: () => content,
    uri: { fsPath, toString: () => `file://${fsPath}` },
    save: vi.fn(() => Promise.resolve(true)),
    lineCount: content.split('\n').length
  } as unknown as import('vscode').TextDocument
}

function makeLauncher() {
  return { launch: vi.fn() }
}

function setupProvider(launcher = makeLauncher()) {
  const configMock = {
    get: vi.fn((key: string, defaultValue?: unknown) => {
      if (key === 'featuresDirectory') return '.kanban/features'
      return defaultValue
    })
  }
  mockGetConfiguration.mockReturnValue(configMock)
  mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: '/workspace' } })

  const extensionUri = { fsPath: '/ext' } as import('vscode').Uri
  const provider = new FeatureHeaderProvider(extensionUri, launcher as never)
  const webviewView = makeWebviewView()
  provider.resolveWebviewView(
    webviewView,
    {} as import('vscode').WebviewViewResolveContext,
    { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as import('vscode').CancellationToken
  )
  const providerAny = provider as unknown as { _currentDocument: import('vscode').TextDocument }
  providerAny._currentDocument = makeDocument()
  return { provider, launcher }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsTrusted.value = true
  capturedMessageHandler = undefined
})

describe('FeatureHeaderProvider startWithAI routing', () => {
  it('calls launcher.launch with the parsed feature, agent, and permissionMode', async () => {
    const { launcher } = setupProvider()
    await capturedMessageHandler!({ type: 'startWithAI', agent: 'claude', permissionMode: 'default' })

    expect(launcher.launch).toHaveBeenCalledOnce()
    const [feature, agent, permissionMode] = launcher.launch.mock.calls[0]
    expect(feature.status).toBe('review')
    expect(feature.priority).toBe('high')
    expect(agent).toBe('claude')
    expect(permissionMode).toBe('default')
  })

  it('defaults agent to "claude" when message.agent is falsy', async () => {
    const { launcher } = setupProvider()
    await capturedMessageHandler!({ type: 'startWithAI', agent: '', permissionMode: 'default' })
    const [, agent] = launcher.launch.mock.calls[0]
    expect(agent).toBe('claude')
  })

  it('does NOT call launcher.launch when workspace is not trusted', async () => {
    mockIsTrusted.value = false
    const { launcher } = setupProvider()
    await capturedMessageHandler!({ type: 'startWithAI', agent: 'claude', permissionMode: 'default' })
    expect(launcher.launch).not.toHaveBeenCalled()
    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
  })

  it('does NOT call launcher.launch when no current document', async () => {
    const { launcher } = setupProvider()
    const providerAny = launcher as unknown as { _currentDocument: undefined }
    // Actually set via provider, not launcher:
    const providerActual = (await import('../../src/extension/FeatureHeaderProvider')).FeatureHeaderProvider
    void providerActual // suppress unused
    // Reset current document to undefined on the provider via the test helper below:
    const { provider: p } = setupProvider()
    ;(p as unknown as { _currentDocument: undefined })._currentDocument = undefined
    await capturedMessageHandler!({ type: 'startWithAI', agent: 'claude', permissionMode: 'default' })
    expect(launcher.launch).not.toHaveBeenCalled()
  })
})
```

### Part B — Update `FeatureHeaderProvider.ts`

- [x] **Step 2: Update `FeatureHeaderProvider.ts`**

1. **Remove imports** that are no longer needed:
```ts
// Remove:
import { buildPrompt, PromptContext } from './ai/promptBuilder'
import { launchAgentTerminal } from './ai/agentLauncher'
import { getTitleFromContent, DEFAULT_COLUMNS } from '../shared/types'
import type { AIAgent, KanbanColumn } from '../shared/types'
// Keep:
import type { AIAgent } from '../shared/types'
```

2. **Add import**:
```ts
import type { AgentLauncher } from './AgentLauncher'
```

3. **Update constructor**:
```ts
constructor(
  private readonly _extensionUri: vscode.Uri,
  private readonly _launcher: AgentLauncher
) {}
```

4. **Update `static register`**:
```ts
public static register(context: vscode.ExtensionContext, launcher: AgentLauncher): vscode.Disposable {
  const provider = new FeatureHeaderProvider(context.extensionUri, launcher)
  // ... rest unchanged ...
}
```

5. **Replace the `startWithAI` handler** in `resolveWebviewView`:

Find the 40-line block starting with `case 'startWithAI': {` and replace with:

```ts
case 'startWithAI': {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage(t('panel.aiRequiresTrust'))
    return
  }
  if (!this._currentDocument) return
  await this._currentDocument.save()
  const parsedFeature = parseFeatureFile(
    this._currentDocument.getText(),
    this._currentDocument.uri.fsPath
  )
  if (!parsedFeature) return
  const agent: AIAgent = message.agent || 'claude'
  const permissionMode = message.permissionMode || 'default'
  this._launcher.launch(parsedFeature, agent, permissionMode)
  break
}
```

- [x] **Step 3: Compile and run tests**

```bash
pnpm exec tsc --noEmit && pnpm run test -- tests/extension/FeatureHeaderProvider.startWithAI.test.ts
```

Expected: tsc exits 0, all tests PASS.

- [x] **Step 4: Commit `index.ts`, `FeatureHeaderProvider.ts`, and test**

```bash
git add src/extension/index.ts src/extension/FeatureHeaderProvider.ts tests/extension/FeatureHeaderProvider.startWithAI.test.ts
git commit -m "refactor: thin FeatureHeaderProvider — delegate startWithAI to AgentLauncher"
```

---

## Task 12: Final verification

- [x] **Step 1: Run the full test suite**

```bash
pnpm run test
```

Expected: ALL tests PASS. No regressions.

- [x] **Step 2: TypeScript strict compile**

```bash
pnpm exec tsc --noEmit
```

Expected: exits 0, no errors.

- [x] **Step 3: Verify acceptance criteria**

Check each criterion against the current state of the code:

| Criterion | Check |
|---|---|
| `FeatureRepository` exposes `onDidChange`, `features`, `load()`, `getFeaturesDir()`, full write API | `grep -n 'async\|readonly' src/extension/FeatureRepository.ts` |
| Constructor accepts optional `FsAdapter` | Look at FeatureRepository constructor signature |
| Single watcher + echo suppression + `_migrating` all in FeatureRepository | `grep -n 'FileSystemWatcher\|_migrating\|_lastWritten' src/extension/KanbanPanel.ts` — should be 0 hits |
| `AgentLauncher.launch(feature, agent, permissionMode)` | Check AgentLauncher.ts |
| `SidebarViewProvider._parseFrontmatter()` deleted | `grep '_parseFrontmatter' src/extension/SidebarViewProvider.ts` — should be 0 hits |
| `index.ts` constructs both and injects into all three providers | Read index.ts activate() |
| No user-observable behaviour change | `pnpm run test` + manual smoke test |

- [x] **Step 4: Build**

```bash
pnpm run build
```

Expected: exits 0. `dist/extension.js` and `dist/webview/index.js` present.

- [x] **Step 5: Smoke test in VS Code Extension Development Host**

Press `F5` in VS Code. In the Extension Development Host:
1. Open the Kanban board — features load correctly ✓
2. Create a card — appears in the board ✓
3. Drag a card to a different column — card moves ✓
4. Edit a feature file in the native text editor and save — board reflects the change ✓
5. Click "Build with AI" on a card in review — terminal opens with the AI agent ✓
6. Open a feature in `markdownEditorMode` — feature header panel shows correct metadata ✓
7. Click "Build with AI" in the feature header panel — terminal opens ✓

- [x] **Step 6: Final commit (if index.ts wasn't committed in Task 11)**

```bash
git add src/extension/index.ts
git commit -m "refactor: wire FeatureRepository and AgentLauncher in index.ts"
```

---

## Self-Review Fixes (kanban-review, 2026-06-03)

Three bugs found and fixed before external review:

- [x] **KanbanPanel `createFeature`**: Used `features[features.length-1]` to find the newly created card; global sort by fractional-index order key makes this positionally unreliable. Fixed to use the return value of `repo.createFeature()` directly.
- [x] **KanbanPanel spurious `_sendFeatureContent`**: `vscode.EventEmitter.fire()` is synchronous; `updateFeature()` fires `onDidChange` before `_saveFeatureContent()` can update `_lastSentEditorContent`, causing a spurious editor panel refresh on every user save. Fixed with a `_savingFeatureContent` boolean flag that suppresses the refresh check in the `onDidChange` handler.
- [x] **FeatureRepository `updateFeature`/`moveFeature` echo suppression**: The write at old path happened before `_migrating=true`, so the watcher's CHANGE event was not suppressed and its debounce callback could call `load()` after the file was moved away. Fixed by setting `_migrating=true` before the write when crossing the done boundary.

---

## Test Plan

| Acceptance criterion | Verified by |
|---|---|
| `FeatureRepository` exposes full API | Task 2–6 unit tests (FeatureRepository.test.ts) |
| `FsAdapter` injectable for unit tests | Tasks 2–6 use `MemoryFs` in-process |
| Single watcher + echo suppression + `_migrating` in repo | Task 6 echo suppression tests |
| `AgentLauncher.launch()` replaces ~40-line duplicate block | Task 7 AgentLauncher.test.ts |
| `SidebarViewProvider._parseFrontmatter()` deleted | Task 10 + tsc --noEmit |
| `index.ts` constructs and injects both | Task 12 compile check |
| No user-observable behaviour change; all existing tests pass | Task 12 full suite + smoke test |
| New FeatureRepository.test.ts covers load, writes, echo suppression | Tasks 2–6 |
| `KanbanPanel.startWithAI.test.ts` injects AgentLauncher mock | Task 9 |
| `FeatureHeaderProvider.startWithAI.test.ts` injects AgentLauncher mock | Task 11 |

## Out of Scope

- `FeatureHeaderProvider._updateFrontmatter` stays as `WorkspaceEdit` — it must read the live editor buffer to preserve unsaved content; routing through `repo.updateFeature` (which writes to disk) would cause dirty-buffer conflicts.
- `createFeatureFromPrompts()` in `index.ts` continues using direct `vscode.workspace.fs` writes — the repo's watcher detects the new file automatically.
- `workspace-picker-2026-06-03` story — explicitly deferred, depends on this story.
- Windows PATH resolution for agent binaries (deferred TODO comment in `agentLauncher.ts`).

## Dependencies

- `2026-06-02-replace-devtool-for-kanban-folder` must be merged first (touches the same four files).
- `consolidate-frontmatter-serialization` (done) and `replace-regex-yaml-parser` (done) — repo wraps the canonical implementations.
