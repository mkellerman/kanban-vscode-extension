---
id: "add-superpowers-specplan-files-2026-06-03"
status: "review"
priority: "medium"
created: "2026-06-04T07:11:24.000Z"
modified: "2026-06-04T07:11:24.000Z"
labels: []
worktree: ".claude/worktrees/story+add-superpowers-specplan-files-2026-06-03"
---
# Implementation Plan: Frontmatter Grooming + Multi-Repository

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Load `docs/superpowers/` files onto the kanban board by generalizing `FeatureRepository` to be schema-aware, aggregating multiple repo instances via `FeatureRepositoryManager`, and adding a Claude Code hook that auto-adds frontmatter to any `.md` written in a groomed directory.

**Architecture:** `FeatureRepository` gains a backward-compatible `{ relativeDir, schema }` constructor config; when schema is `'superpowers'` it recursively loads all `.md` files and skips the done-subfolder and migration logic. `FeatureRepositoryManager` owns N repos, presents the same public surface as `FeatureRepository` via `IFeatureRepository`, and routes writes to the owning repo. `index.ts` creates the manager from a new `kanban-extension.groomedDirectories` VS Code setting. A Python PostToolUse hook (`groom_frontmatter.py`) fills in missing frontmatter so newly written superpowers files are immediately parseable.

**Tech Stack:** TypeScript, VS Code Extension API, Vitest, Python 3

---

## File Map

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `SchemaType`, `GroomedDirectory` |
| `src/extension/FeatureRepository.ts` | Export `IFeatureRepository`; generalize constructor; add `_loadAllMd()`; branch on schema |
| `src/extension/FeatureRepositoryManager.ts` | New — aggregator class |
| `src/extension/KanbanPanel.ts` | `FeatureRepository` → `IFeatureRepository` in type annotations |
| `src/extension/SidebarViewProvider.ts` | `FeatureRepository` → `IFeatureRepository` |
| `src/extension/FeatureHeaderProvider.ts` | `FeatureRepository` → `IFeatureRepository` |
| `src/extension/index.ts` | Create manager from `groomedDirectories`; update `createFeatureFromPrompts` type |
| `package.json` | Add `kanban-extension.groomedDirectories` setting |
| `package.nls.json` | Add description key |
| `tests/extension/FeatureRepository.test.ts` | Extend `MemoryFs.readDirectory` to return dirs; add superpowers load test |
| `tests/extension/FeatureRepositoryManager.test.ts` | New — manager unit tests |
| `.claude/hooks/groom_frontmatter.py` | New — PostToolUse hook |
| `.claude/settings.json` | New — hook registration |

---

### Task 1: Add `SchemaType` and `GroomedDirectory` to shared types

**Files:**
- Modify: `src/shared/types.ts`

- [x] **Step 1: Add the two new types after the existing `FilenamePattern` type**

In `src/shared/types.ts`, after the `FilenamePattern` export (currently line 35), add:

```typescript
export type SchemaType = 'feature' | 'superpowers'

export interface GroomedDirectory {
  path: string
  schema: SchemaType
}
```

- [x] **Step 2: Run typecheck to confirm no breakage**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [x] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add SchemaType and GroomedDirectory to shared types"
```

---

### Task 2: Generalize `FeatureRepository`

**Files:**
- Modify: `src/extension/FeatureRepository.ts`

- [x] **Step 1: Export `IFeatureRepository` interface**

Add this block immediately before `export interface CreateFeatureData` (currently line 25):

```typescript
import type { SchemaType } from '../shared/types'

export interface IFeatureRepository extends vscode.Disposable {
  readonly features: readonly Feature[]
  readonly onDidChange: vscode.Event<readonly Feature[]>
  getFeaturesDir(): string | null
  setRoot(newRoot: string | null): Promise<void>
  setRootSync(newRoot: string | null): void
  load(): Promise<void>
  createFeature(data: CreateFeatureData): Promise<Feature>
  updateFeature(featureId: string, updates: Partial<Feature>): Promise<void>
  moveFeature(featureId: string, newStatus: string, newOrder: number): Promise<void>
  deleteFeature(featureId: string): Promise<void>
  moveAllFeatures(sourceColumnId: string, targetColumnId: string, epicLane?: string | null): Promise<void>
  archiveFeatures(sourceColumnId: string): Promise<{ failedCount: number }>
  renameLabel(oldName: string, newName: string): Promise<number>
  deleteLabel(labelName: string): Promise<void>
  migrateFilenames(pattern: FilenamePattern): Promise<{ renamed: number; skipped: number }>
}
```

Then update the class declaration to:

```typescript
export class FeatureRepository implements IFeatureRepository {
```

- [x] **Step 2: Replace the private field declarations and constructor**

Replace the current field declarations at the top of the class (lines 36–46 in the original) and the constructor (lines 49–52) with:

```typescript
  private _features: Feature[] = []
  private _emitter = new vscode.EventEmitter<readonly Feature[]>()
  private _fileWatcher?: vscode.FileSystemWatcher
  private _watcherDisposables: vscode.Disposable[] = []
  private _currentWatcherDir: string | null = null
  private _migrating = false
  private _debounceTimer?: ReturnType<typeof setTimeout>
  private _lastWrittenContents = new Map<string, string>()
  private _rootOverride: string | null = null
  private _loadVersion = 0
  private readonly _relativeDir: string | null
  private readonly _schema: SchemaType
  private readonly _fs: FsAdapter

  readonly onDidChange: vscode.Event<readonly Feature[]> = this._emitter.event

  constructor(
    private readonly _context: vscode.ExtensionContext,
    configOrFs?: { relativeDir?: string; schema?: SchemaType } | FsAdapter,
    fs?: FsAdapter
  ) {
    if (configOrFs && 'readFile' in configOrFs) {
      // backward-compat: new FeatureRepository(context, memFs)
      this._fs = configOrFs as FsAdapter
      this._relativeDir = null
      this._schema = 'feature'
    } else {
      const cfg = configOrFs as { relativeDir?: string; schema?: SchemaType } | undefined
      this._relativeDir = cfg?.relativeDir ?? null
      this._schema = cfg?.schema ?? 'feature'
      this._fs = fs ?? (vscode.workspace.fs as unknown as FsAdapter)
    }
  }

  get schema(): SchemaType { return this._schema }
```

- [x] **Step 3: Update `getFeaturesDir()` to use `_relativeDir`**

Replace the body of `getFeaturesDir()` (currently lines 63–68):

```typescript
  getFeaturesDir(): string | null {
    const root = this.getEffectiveRoot()
    if (!root) return null
    const dir = this._relativeDir ??
      (vscode.workspace.getConfiguration('kanban-extension').get<string>('featuresDirectory') || '.kanban/features')
    return path.join(root, dir)
  }
```

- [x] **Step 4: Add `_loadAllMd()` recursive helper**

Add this private method immediately before `dispose()` at the bottom of the class:

```typescript
  private async _loadAllMd(dir: string): Promise<Feature[]> {
    const features: Feature[] = []
    let entries: [string, number][]
    try {
      entries = await this._fs.readDirectory(vscode.Uri.file(dir))
    } catch { return features }
    for (const [name, type] of entries) {
      const fullPath = path.join(dir, name)
      if (type === 1 /* File */ && name.endsWith('.md')) {
        try {
          const bytes = await this._fs.readFile(vscode.Uri.file(fullPath))
          const raw = new TextDecoder().decode(bytes)
          const feature = parseFeatureFile(raw, fullPath)
          if (feature) features.push(feature)
        } catch { /* skip unreadable files */ }
      } else if (type === 2 /* Directory */) {
        features.push(...await this._loadAllMd(fullPath))
      }
    }
    return features
  }
```

- [x] **Step 5: Branch `load()` on schema — add superpowers path at the start**

At the start of the `try` block inside `load()`, just after `await this._fs.createDirectory(...)` (which is currently the first line of the try block), add the superpowers early-return:

Actually, restructure: add the branch **after the watcher setup and null check**, right at the start of the try block. Replace the opening of the try block:

```typescript
    try {
      if (this._schema === 'superpowers') {
        const features = await this._loadAllMd(featuresDir)
        if (myVersion === this._loadVersion) {
          this._features = features
          this._emitter.fire(this._features)
        }
        return
      }

      await this._fs.createDirectory(vscode.Uri.file(featuresDir))
      await ensureStatusSubfolders(featuresDir, this._fs)
      // ... rest of existing feature-schema load (Phase 1, 2, 3)
```

- [x] **Step 6: Gate done-file moves on `'feature'` schema in `updateFeature`**

In `updateFeature()`, change the `crossingDoneUpdate` line (currently uses `oldStatus !== feature.status ...`):

```typescript
    const crossingDoneUpdate = this._schema === 'feature' &&
      oldStatus !== feature.status && (oldStatus === 'done' || feature.status === 'done')
```

- [x] **Step 7: Gate done-file moves in `moveFeature`**

In `moveFeature()`, change the `crossingDone` line:

```typescript
    const crossingDone = this._schema === 'feature' &&
      oldStatus !== newStatus && (oldStatus === 'done' || newStatus === 'done')
```

- [x] **Step 8: Gate done-file moves in `moveAllFeatures`**

In `moveAllFeatures()`, change the `crossingDone` line:

```typescript
    const crossingDone = this._schema === 'feature' &&
      (sourceColumnId === 'done' || targetColumnId === 'done')
```

- [x] **Step 9: Guard `migrateFilenames` for feature schema only**

At the top of `migrateFilenames()`, add a guard:

```typescript
  async migrateFilenames(pattern: FilenamePattern): Promise<{ renamed: number; skipped: number }> {
    if (this._schema !== 'feature') return { renamed: 0, skipped: 0 }
    // ... rest unchanged
```

- [x] **Step 10: Run typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [x] **Step 11: Run existing tests**

```bash
pnpm test -- tests/extension/FeatureRepository.test.ts tests/extension/FeatureRepository.fileErrors.test.ts
```

Expected: all tests pass (constructor backward-compat means existing tests need no changes).

- [x] **Step 12: Commit**

```bash
git add src/extension/FeatureRepository.ts
git commit -m "feat: generalize FeatureRepository with schema-aware config and IFeatureRepository interface"
```

---

### Task 3: Extend `MemoryFs` and add superpowers tests

**Files:**
- Modify: `tests/extension/FeatureRepository.test.ts`

- [x] **Step 1: Extend `MemoryFs.readDirectory` to return subdirectory entries**

In `tests/extension/FeatureRepository.test.ts`, replace the `readDirectory` method inside the `MemoryFs` class (currently returns only files, `if (!rest.includes('/'))`) with:

```typescript
  async readDirectory(uri: { fsPath: string }): Promise<[string, number][]> {
    const prefix = uri.fsPath.replace(/\/?$/, '/')
    const result: [string, number][] = []
    const seenDirs = new Set<string>()
    for (const [p] of this._files) {
      if (p.startsWith(prefix)) {
        const rest = p.slice(prefix.length)
        if (!rest.includes('/')) {
          result.push([rest, 1]) // FileType.File
        } else {
          const dir = rest.split('/')[0]
          if (!seenDirs.has(dir)) {
            seenDirs.add(dir)
            result.push([dir, 2]) // FileType.Directory
          }
        }
      }
    }
    return result
  }
```

- [x] **Step 2: Run existing tests to confirm no regression**

```bash
pnpm test -- tests/extension/FeatureRepository.test.ts
```

Expected: all pass (the feature-schema load code skips `type !== 1` entries, so returning dirs is harmless).

- [x] **Step 3: Write failing superpowers load test**

Add this new `describe` block at the end of `tests/extension/FeatureRepository.test.ts`:

```typescript
describe('FeatureRepository — superpowers schema', () => {
  let memFs: MemoryFs
  const SP_DIR = '/workspace/docs/superpowers'

  beforeEach(() => {
    memFs = new MemoryFs()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeSpMd(id: string, status = 'todo') {
    return [
      '---',
      `id: "${id}"`,
      `type: "spec"`,
      `title: "My Spec"`,
      `slug: "${id}"`,
      `status: "${status}"`,
      `priority: "medium"`,
      `parent: null`,
      `blockedBy: []`,
      `relatedTo: []`,
      `labels: []`,
      `created: "2026-06-03T00:00:00Z"`,
      `modified: "2026-06-03T00:00:00Z"`,
      '---',
      '',
      '# My Spec',
      '',
      'Content here.'
    ].join('\n')
  }

  it('loads .md files from root of superpowers dir', async () => {
    memFs.write(`${SP_DIR}/my-spec.md`, makeSpMd('my-spec'))
    const repo = new FeatureRepository(
      makeContext(),
      { relativeDir: 'docs/superpowers', schema: 'superpowers' },
      memFs as unknown as FsAdapter
    )
    await repo.load()
    expect(repo.features).toHaveLength(1)
    expect(repo.features[0].id).toBe('my-spec')
    expect(repo.features[0].status).toBe('todo')
  })

  it('loads .md files recursively from subdirectories', async () => {
    memFs.write(`${SP_DIR}/specs/spec-a.md`, makeSpMd('spec-a'))
    memFs.write(`${SP_DIR}/plans/plan-b.md`, makeSpMd('plan-b', 'done'))
    const repo = new FeatureRepository(
      makeContext(),
      { relativeDir: 'docs/superpowers', schema: 'superpowers' },
      memFs as unknown as FsAdapter
    )
    await repo.load()
    expect(repo.features).toHaveLength(2)
    const ids = repo.features.map(f => f.id).sort()
    expect(ids).toEqual(['plan-b', 'spec-a'])
  })

  it('does not move files to done/ on status change', async () => {
    memFs.write(`${SP_DIR}/my-spec.md`, makeSpMd('my-spec', 'todo'))
    const repo = new FeatureRepository(
      makeContext(),
      { relativeDir: 'docs/superpowers', schema: 'superpowers' },
      memFs as unknown as FsAdapter
    )
    await repo.load()
    await repo.updateFeature('my-spec', { status: 'done' })
    // file stays at original path — no done/ subdir
    expect(memFs.has(`${SP_DIR}/my-spec.md`)).toBe(true)
    expect(memFs.has(`${SP_DIR}/done/my-spec.md`)).toBe(false)
  })

  it('fires onDidChange after superpowers load', async () => {
    memFs.write(`${SP_DIR}/my-spec.md`, makeSpMd('my-spec'))
    const repo = new FeatureRepository(
      makeContext(),
      { relativeDir: 'docs/superpowers', schema: 'superpowers' },
      memFs as unknown as FsAdapter
    )
    const listener = vi.fn()
    repo.onDidChange(listener)
    await repo.load()
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0]).toHaveLength(1)
  })
})
```

- [x] **Step 4: Run new tests to confirm they fail (not yet passing)**

```bash
pnpm test -- tests/extension/FeatureRepository.test.ts
```

Expected: the new superpowers tests fail because the schema-aware changes aren't in yet if you're doing strict TDD, OR pass if Task 2 is already done. If Task 2 is done, all tests should pass.

- [x] **Step 5: Confirm all tests pass**

```bash
pnpm test -- tests/extension/FeatureRepository.test.ts tests/extension/FeatureRepository.fileErrors.test.ts
```

Expected: all pass.

- [x] **Step 6: Commit**

```bash
git add tests/extension/FeatureRepository.test.ts
git commit -m "test: add superpowers schema tests for FeatureRepository"
```

---

### Task 4: Update consumer type annotations to `IFeatureRepository`

**Files:**
- Modify: `src/extension/KanbanPanel.ts`
- Modify: `src/extension/SidebarViewProvider.ts`
- Modify: `src/extension/FeatureHeaderProvider.ts`

- [x] **Step 1: Update `KanbanPanel.ts`**

Change the import on line 8:
```typescript
import type { IFeatureRepository, CreateFeatureData } from './FeatureRepository'
```

Change the field declaration on line 18:
```typescript
  private _repo: IFeatureRepository
```

Change all three `repo: FeatureRepository` parameter types (in `createOrShow`, `revive`, and constructor) to:
```typescript
repo: IFeatureRepository
```

- [x] **Step 2: Update `SidebarViewProvider.ts`**

Change the import on line 5:
```typescript
import type { IFeatureRepository } from './FeatureRepository'
```

Change the field declaration on line 18:
```typescript
    private readonly _repo: IFeatureRepository
```

- [x] **Step 3: Update `FeatureHeaderProvider.ts`**

Change the import on line 8:
```typescript
import type { IFeatureRepository } from './FeatureRepository'
```

Change the field declaration on line 24:
```typescript
    private readonly _repo: IFeatureRepository
```

Change the `register` static method parameter on line 27:
```typescript
  public static register(context: vscode.ExtensionContext, launcher: AgentLauncher, repo: IFeatureRepository): vscode.Disposable {
```

- [x] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [x] **Step 5: Run tests**

```bash
pnpm test
```

Expected: all pass.

- [x] **Step 6: Commit**

```bash
git add src/extension/KanbanPanel.ts src/extension/SidebarViewProvider.ts src/extension/FeatureHeaderProvider.ts
git commit -m "refactor: use IFeatureRepository interface in all consumers"
```

---

### Task 5: Write `FeatureRepositoryManager`

**Files:**
- Create: `src/extension/FeatureRepositoryManager.ts`
- Create: `tests/extension/FeatureRepositoryManager.test.ts`

- [x] **Step 1: Write the failing test first**

Create `tests/extension/FeatureRepositoryManager.test.ts`:

```typescript
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
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
pnpm test -- tests/extension/FeatureRepositoryManager.test.ts
```

Expected: FAIL with "Cannot find module '../../src/extension/FeatureRepositoryManager'".

- [x] **Step 3: Implement `FeatureRepositoryManager`**

Create `src/extension/FeatureRepositoryManager.ts`:

```typescript
import * as vscode from 'vscode'
import { FeatureRepository, type CreateFeatureData, type IFeatureRepository } from './FeatureRepository'
import type { Feature, FilenamePattern, GroomedDirectory } from '../shared/types'
import type { FsAdapter } from './featureFileUtils'

export class FeatureRepositoryManager implements IFeatureRepository {
  private readonly _repos: FeatureRepository[]
  private readonly _emitter = new vscode.EventEmitter<readonly Feature[]>()
  private readonly _disposables: vscode.Disposable[] = []

  readonly onDidChange: vscode.Event<readonly Feature[]> = this._emitter.event

  constructor(
    context: vscode.ExtensionContext,
    dirs: GroomedDirectory[],
    fs?: FsAdapter
  ) {
    this._repos = dirs.map(d =>
      new FeatureRepository(context, { relativeDir: d.path, schema: d.schema }, fs)
    )
    for (const repo of this._repos) {
      this._disposables.push(
        repo.onDidChange(() => this._emitter.fire(this.features))
      )
    }
  }

  get features(): readonly Feature[] {
    return this._repos.flatMap(r => [...r.features])
  }

  getFeaturesDir(): string | null {
    return this._primaryRepo()?.getFeaturesDir() ?? null
  }

  private _primaryRepo(): FeatureRepository | undefined {
    return this._repos.find(r => r.schema === 'feature')
  }

  private _ownerOf(featureId: string): FeatureRepository | undefined {
    return this._repos.find(r => r.features.some(f => f.id === featureId))
  }

  async setRoot(newRoot: string | null): Promise<void> {
    await Promise.all(this._repos.map(r => r.setRoot(newRoot)))
  }

  setRootSync(newRoot: string | null): void {
    this._repos.forEach(r => r.setRootSync(newRoot))
  }

  async load(): Promise<void> {
    await Promise.all(this._repos.map(r => r.load()))
  }

  async createFeature(data: CreateFeatureData): Promise<Feature> {
    const repo = this._primaryRepo()
    if (!repo) throw new Error('No feature-schema repository configured')
    return repo.createFeature(data)
  }

  async updateFeature(featureId: string, updates: Partial<Feature>): Promise<void> {
    await this._ownerOf(featureId)?.updateFeature(featureId, updates)
  }

  async moveFeature(featureId: string, newStatus: string, newOrder: number): Promise<void> {
    await this._ownerOf(featureId)?.moveFeature(featureId, newStatus, newOrder)
  }

  async deleteFeature(featureId: string): Promise<void> {
    await this._ownerOf(featureId)?.deleteFeature(featureId)
  }

  async moveAllFeatures(
    sourceColumnId: string,
    targetColumnId: string,
    epicLane?: string | null
  ): Promise<void> {
    await Promise.all(this._repos.map(r => r.moveAllFeatures(sourceColumnId, targetColumnId, epicLane)))
  }

  async archiveFeatures(sourceColumnId: string): Promise<{ failedCount: number }> {
    const results = await Promise.all(this._repos.map(r => r.archiveFeatures(sourceColumnId)))
    return { failedCount: results.reduce((sum, r) => sum + r.failedCount, 0) }
  }

  async renameLabel(oldName: string, newName: string): Promise<number> {
    const counts = await Promise.all(this._repos.map(r => r.renameLabel(oldName, newName)))
    return counts.reduce((a, b) => a + b, 0)
  }

  async deleteLabel(labelName: string): Promise<void> {
    await Promise.all(this._repos.map(r => r.deleteLabel(labelName)))
  }

  async migrateFilenames(pattern: FilenamePattern): Promise<{ renamed: number; skipped: number }> {
    const results = await Promise.all(this._repos.map(r => r.migrateFilenames(pattern)))
    return {
      renamed: results.reduce((s, r) => s + r.renamed, 0),
      skipped: results.reduce((s, r) => s + r.skipped, 0)
    }
  }

  dispose(): void {
    this._disposables.forEach(d => d.dispose())
    this._repos.forEach(r => r.dispose())
    this._emitter.dispose()
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- tests/extension/FeatureRepositoryManager.test.ts
```

Expected: all pass.

- [x] **Step 5: Run full suite**

```bash
pnpm test
```

Expected: all pass.

- [x] **Step 6: Commit**

```bash
git add src/extension/FeatureRepositoryManager.ts tests/extension/FeatureRepositoryManager.test.ts
git commit -m "feat: add FeatureRepositoryManager that aggregates multiple schema-aware repos"
```

---

### Task 6: Wire `index.ts` to use `FeatureRepositoryManager`

**Files:**
- Modify: `src/extension/index.ts`

- [x] **Step 1: Replace the import and instantiation in `index.ts`**

Change the import on line 10 (replacing `import { FeatureRepository } from './FeatureRepository'`):
```typescript
import { FeatureRepositoryManager } from './FeatureRepositoryManager'
import type { IFeatureRepository } from './FeatureRepository'
import type { GroomedDirectory, SchemaType } from '../shared/types'
```

Change the `createFeatureFromPrompts` parameter type (line 22):
```typescript
async function createFeatureFromPrompts(repo: IFeatureRepository): Promise<void> {
```

In the `activate` function, replace `const repo = new FeatureRepository(context)` with:

```typescript
  const config = vscode.workspace.getConfiguration('kanban-extension')
  const groomedDirs = config.get<GroomedDirectory[]>('groomedDirectories') ?? []
  const effectiveDirs: GroomedDirectory[] = groomedDirs.length > 0
    ? groomedDirs
    : [
        { path: config.get<string>('featuresDirectory') || '.kanban/features', schema: 'feature' as SchemaType },
        { path: 'docs/superpowers', schema: 'superpowers' as SchemaType }
      ]
  const repo = new FeatureRepositoryManager(context, effectiveDirs)
```

- [x] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [x] **Step 3: Run full test suite**

```bash
pnpm test
```

Expected: all pass.

- [x] **Step 4: Commit**

```bash
git add src/extension/index.ts
git commit -m "feat: wire FeatureRepositoryManager in index.ts from groomedDirectories config"
```

---

### Task 7: Add `kanban-extension.groomedDirectories` VS Code setting

**Files:**
- Modify: `package.json`
- Modify: `package.nls.json`

- [x] **Step 1: Add the setting to `package.json`**

In `package.json`, find the `"kanban-extension.featuresDirectory"` block inside `"contributes.configuration.properties"`. Add the following entry immediately after it:

```json
"kanban-extension.groomedDirectories": {
  "type": "array",
  "default": [],
  "items": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Relative path from workspace root"
      },
      "schema": {
        "type": "string",
        "enum": ["feature", "superpowers"],
        "description": "Frontmatter schema to apply to files in this directory"
      }
    },
    "required": ["path", "schema"],
    "additionalProperties": false
  },
  "description": "%config.groomedDirectories.description%"
},
```

(Note: `default: []` means VS Code returns empty array if user hasn't configured it, and `index.ts` falls back to the two default dirs. This lets users opt in to a custom list by setting the key explicitly.)

- [x] **Step 2: Add the NLS description string**

In `package.nls.json`, after the `"config.featuresDirectory.description"` line, add:

```json
"config.groomedDirectories.description": "List of directories (relative to workspace root) to load as kanban cards, each with a schema type. When empty, defaults to .kanban/features (feature schema) and docs/superpowers (superpowers schema).",
```

- [x] **Step 3: Verify `pnpm check-l10n` passes**

```bash
pnpm check-l10n
```

Expected: no missing keys reported.

- [x] **Step 4: Run typecheck and tests**

```bash
pnpm typecheck && pnpm test
```

Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add package.json package.nls.json
git commit -m "feat: add kanban-extension.groomedDirectories VS Code setting"
```

---

### Task 8: Write the frontmatter grooming hook

**Files:**
- Create: `.claude/hooks/groom_frontmatter.py`

- [x] **Step 1: Create the hooks directory and write the script**

```bash
mkdir -p /Users/me/GitHub/kanban-vscode-extension/.claude/hooks
```

Create `.claude/hooks/groom_frontmatter.py`:

```python
#!/usr/bin/env python3
"""
PostToolUse hook: adds missing frontmatter to .md files in groomed directories.

Reads kanban-extension.groomedDirectories from .vscode/settings.json.
Falls back to hardcoded defaults (.kanban/features, docs/superpowers).

Exit 0 always — this hook is advisory and never blocks the tool.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULTS = [
    {"path": ".kanban/features", "schema": "feature"},
    {"path": "docs/superpowers", "schema": "superpowers"},
]

FEATURE_FIELDS = [
    "id", "status", "priority", "assignee", "epic", "dueDate",
    "created", "modified", "completedAt", "labels", "order",
]

SUPERPOWERS_FIELDS = [
    "id", "type", "title", "slug", "status", "priority",
    "parent", "blockedBy", "relatedTo", "labels", "created", "modified",
]

DATE_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-")


def load_groomed_dirs():
    settings = Path(".vscode/settings.json")
    if settings.exists():
        try:
            with open(settings, encoding="utf-8") as f:
                data = json.load(f)
            dirs = data.get("kanban-extension.groomedDirectories")
            if dirs:
                return dirs
        except Exception:
            pass
    return DEFAULTS


def schema_for_file(file_path: Path, groomed_dirs: list) -> tuple:
    """Return (schema, dir_path) for the first matching groomed dir, or (None, None)."""
    cwd = Path.cwd()
    try:
        resolved = file_path.resolve()
    except Exception:
        return None, None
    for entry in groomed_dirs:
        dir_abs = (cwd / entry["path"]).resolve()
        try:
            resolved.relative_to(dir_abs)
            return entry["schema"], dir_abs
        except ValueError:
            continue
    return None, None


def parse_frontmatter(content: str):
    """Return (dict, body_str) or (None, None) if no frontmatter."""
    if not content.startswith("---\n"):
        return None, None
    end = content.find("\n---\n", 4)
    if end == -1:
        return None, None
    yaml_text = content[4:end]
    body = content[end + 5:]  # skip \n---\n
    try:
        import yaml
        data = yaml.safe_load(yaml_text)
        if not isinstance(data, dict):
            return None, None
        return data, body
    except ImportError:
        return _parse_simple(yaml_text), body
    except Exception:
        return None, None


def _parse_simple(yaml_text: str) -> dict:
    data = {}
    lines = yaml_text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.startswith("#"):
            i += 1
            continue
        m = re.match(r"^(\w+):\s*(.*)", line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            if val == "null":
                data[key] = None
            elif val.startswith('"') and val.endswith('"'):
                data[key] = val[1:-1]
            elif val == "[]":
                data[key] = []
            elif val.startswith("["):
                inner = val.lstrip("[").rstrip("]")
                data[key] = [x.strip().strip('"') for x in inner.split(",") if x.strip()]
            elif val == "":
                items = []
                i += 1
                while i < len(lines) and lines[i].startswith("  - "):
                    items.append(lines[i][4:].strip().strip('"'))
                    i += 1
                data[key] = items
                continue
            else:
                data[key] = val
        i += 1
    return data


def serialize_frontmatter(fm: dict) -> str:
    lines = []
    for key, val in fm.items():
        if val is None:
            lines.append(f"{key}: null")
        elif isinstance(val, list):
            if not val:
                lines.append(f"{key}: []")
            else:
                items = ", ".join(f'"{v}"' for v in val)
                lines.append(f"{key}: [{items}]")
        else:
            lines.append(f'{key}: "{val}"')
    return "\n".join(lines)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def infer_type_from_path(file_path: Path, dir_abs: Path) -> str:
    try:
        rel = file_path.resolve().relative_to(dir_abs)
        parts = rel.parts
        if len(parts) > 1:
            sub = parts[0]
            if sub == "specs":
                return "spec"
            if sub == "plans":
                return "plan"
            if sub == "guides":
                return "guide"
    except ValueError:
        pass
    return "spec"


def extract_title(body: str) -> str | None:
    m = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
    return m.group(1).strip() if m else None


def slug_from_filename(stem: str) -> str:
    return DATE_PREFIX_RE.sub("", stem)


def created_from_filename(stem: str) -> str:
    m = re.match(r"^(\d{4}-\d{2}-\d{2})-", stem)
    if m:
        return f"{m.group(1)}T00:00:00Z"
    return now_iso()


def infer_feature_fields(fm: dict, file_path: Path) -> dict:
    stem = file_path.stem
    defaults = {
        "id": stem,
        "status": "backlog",
        "priority": "medium",
        "assignee": None,
        "epic": None,
        "dueDate": None,
        "created": now_iso(),
        "modified": now_iso(),
        "completedAt": None,
        "labels": [],
        "order": "a0",
    }
    added = {}
    for field in FEATURE_FIELDS:
        if field not in fm:
            added[field] = defaults[field]
    return added


def infer_superpowers_fields(fm: dict, file_path: Path, dir_abs: Path, body: str) -> dict:
    stem = file_path.stem
    defaults = {
        "id": stem,
        "type": infer_type_from_path(file_path, dir_abs),
        "title": extract_title(body) or stem.replace("-", " ").title(),
        "slug": slug_from_filename(stem),
        "status": "todo",
        "priority": "medium",
        "parent": None,
        "blockedBy": [],
        "relatedTo": [],
        "labels": [],
        "created": created_from_filename(stem),
        "modified": now_iso(),
    }
    added = {}
    for field in SUPERPOWERS_FIELDS:
        if field not in fm:
            added[field] = defaults[field]
    return added


def build_updated_content(fm: dict, added: dict, body: str, had_frontmatter: bool) -> str:
    merged = {**fm, **added}
    # preserve original field order, then appended fields
    ordered = {k: merged[k] for k in list(fm.keys()) + [k for k in added if k not in fm]}
    return f"---\n{serialize_frontmatter(ordered)}\n---\n{body}"


def main():
    try:
        event = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)

    tool_input = event.get("tool_input", {})
    file_path_str = tool_input.get("file_path", "")
    if not file_path_str or not file_path_str.endswith(".md"):
        sys.exit(0)

    file_path = Path(file_path_str)

    groomed_dirs = load_groomed_dirs()
    schema, dir_abs = schema_for_file(file_path, groomed_dirs)
    if schema is None:
        sys.exit(0)

    try:
        with open(file_path, encoding="utf-8") as f:
            content = f.read()
    except OSError as e:
        print(f"WARNING: groom_frontmatter: could not read {file_path}: {e}", file=sys.stderr)
        sys.exit(0)

    fm, body = parse_frontmatter(content)
    had_frontmatter = fm is not None
    if fm is None:
        fm = {}
        body = content

    if schema == "feature":
        added = infer_feature_fields(fm, file_path)
    else:
        added = infer_superpowers_fields(fm, file_path, dir_abs, body or "")

    if not added:
        sys.exit(0)  # nothing to do — idempotent

    new_content = build_updated_content(fm, added, body or "", had_frontmatter)

    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(new_content)
    except OSError as e:
        print(f"WARNING: groom_frontmatter: could not write {file_path}: {e}", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
```

- [x] **Step 2: Make the script executable**

```bash
chmod +x /Users/me/GitHub/kanban-vscode-extension/.claude/hooks/groom_frontmatter.py
```

- [x] **Step 3: Smoke-test the hook against a file with no frontmatter**

```bash
echo "# My Test Spec

Some content." > /tmp/test-spec.md

echo '{"tool_name":"Write","tool_input":{"file_path":"/tmp/test-spec.md"}}' \
  | python3 /Users/me/GitHub/kanban-vscode-extension/.claude/hooks/groom_frontmatter.py
```

Expected: exits 0. The file is not modified (not in a groomed dir) — that's correct.

- [x] **Step 4: Smoke-test against a file in the superpowers dir**

```bash
mkdir -p /Users/me/GitHub/kanban-vscode-extension/docs/superpowers/specs

cat > /Users/me/GitHub/kanban-vscode-extension/docs/superpowers/specs/test-hook-2026-06-04.md << 'EOF'
# Test Hook Spec

Just testing the hook.
EOF

cd /Users/me/GitHub/kanban-vscode-extension && echo '{"tool_name":"Write","tool_input":{"file_path":"/Users/me/GitHub/kanban-vscode-extension/docs/superpowers/specs/test-hook-2026-06-04.md"}}' \
  | python3 .claude/hooks/groom_frontmatter.py

head -20 /Users/me/GitHub/kanban-vscode-extension/docs/superpowers/specs/test-hook-2026-06-04.md
```

Expected output: the file now starts with `---` YAML frontmatter containing at minimum `id`, `type: "spec"`, `title: "Test Hook Spec"`, `status: "todo"`, `created: "2026-06-04T00:00:00Z"`.

- [x] **Step 5: Clean up test file**

```bash
rm /Users/me/GitHub/kanban-vscode-extension/docs/superpowers/specs/test-hook-2026-06-04.md
```

- [x] **Step 6: Commit**

```bash
git add .claude/hooks/groom_frontmatter.py
git commit -m "feat: add groom_frontmatter PostToolUse hook for auto-frontmatter"
```

---

### Task 9: Register the hook in `.claude/settings.json`

**Files:**
- Create: `.claude/settings.json`

- [x] **Step 1: Write failing validation**

Verify `.claude/settings.json` does NOT yet exist:

```bash
ls /Users/me/GitHub/kanban-vscode-extension/.claude/settings.json
```

Expected: `ls: .claude/settings.json: No such file or directory`

- [x] **Step 2: Create `.claude/settings.json`**

Create `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .claude/hooks/groom_frontmatter.py"
          }
        ]
      }
    ]
  }
}
```

- [x] **Step 3: Verify JSON is valid**

```bash
python3 -c "import json; json.load(open('.claude/settings.json')); print('valid')"
```

Expected: `valid`

- [x] **Step 4: Commit**

```bash
git add .claude/settings.json
git commit -m "feat: register groom_frontmatter hook in .claude/settings.json"
```

---

### Task 10: Final verification

- [x] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [x] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [x] **Step 3: Run l10n check**

```bash
pnpm check-l10n
```

Expected: no missing keys.

- [x] **Step 4: Build extension bundle**

```bash
pnpm build
```

Expected: `dist/extension.js` built successfully, no errors.

- [x] **Step 5: Verify existing superpowers files get frontmatter on next write**

Write a superpowers spec that currently has no frontmatter (e.g. `docs/superpowers/specs/2026-06-03-epic-filter-design.md`) using the Claude Code Write or Edit tool — the hook fires and adds frontmatter. Confirm the file now starts with `---`.

- [x] **Step 6: Commit final state**

```bash
git add -A
git commit -m "feat: complete frontmatter grooming + multi-repo board loading"
```

---

## Test Plan

| Acceptance Criterion | Task | Verification |
|---------------------|------|--------------|
| `FeatureRepository` loads superpowers files recursively | Task 2 + 3 | `FeatureRepository — superpowers schema` test suite |
| Files in `done/` are not moved for superpowers schema | Task 2 + 3 | `does not move files to done/` test |
| `FeatureRepositoryManager` aggregates N repos | Task 5 | `aggregates features from both repos` test |
| Writes route to the owning repo | Task 5 | `routes updateFeature to the owning repo` test |
| `index.ts` uses manager from `groomedDirectories` config | Task 6 | typecheck + full test suite |
| VS Code setting appears in settings UI | Task 7 | `pnpm check-l10n` passes |
| Hook adds frontmatter to new superpowers files | Task 8 | smoke-test steps 3–4 |
| Hook is idempotent (no double-write) | Task 8 | re-running hook on already-groomed file exits 0 with no changes |
| All existing tests still pass | Task 10 | `pnpm test` |
| Extension bundle compiles | Task 10 | `pnpm build` succeeds |

## Out of Scope

- UI changes to the kanban board (superpowers cards appear alongside feature cards using existing column logic)
- Filtering or sorting by schema type
- Editing superpowers files via the kanban UI (read/update only — no create-from-board for superpowers schema)
- Hook support for tools other than `Write`, `Edit`, `MultiEdit`
- PyYAML availability — the hook falls back to `_parse_simple` when PyYAML is not installed

## Dependencies

- None — this is a self-contained feature. No blocking stories.
