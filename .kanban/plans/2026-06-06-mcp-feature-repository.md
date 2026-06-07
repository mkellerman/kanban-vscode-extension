# McpFeatureRepository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the kanban board fully read/write against the Backlog MCP when `kanban-extension.dataSource: backlog-mcp`, so clicking native stories opens the detail view, drag-and-drop persists to disk, and edits/creates/deletes round-trip through the native adapter.

**Architecture:** New class `McpFeatureRepository implements IFeatureRepository`. `extension/index.ts` picks the concrete repo at activation based on `dataSource`. `KanbanPanel` and `SidebarViewProvider` lose every `_dataSource()` branch and become source-agnostic. The MCP library's contract gains `order`, `assignee`, `dueDate`, `created`, `modified`, `completedAt` on `WorkItem` (and write surface on `ItemPatch` / `CreateItemInput`) so the round-trip through the native adapter is complete.

**Tech Stack:** TypeScript, VS Code Extension API (`vscode.FileSystemWatcher`, `vscode.EventEmitter`), `@kanban/backlog-mcp` (workspace package), Vitest, zod.

**Reference spec:** `.kanban/specs/2026-06-06-mcp-feature-repository-design.md`

---

## File Structure

**Create:**
- `src/extension/McpFeatureRepository.ts` — new repo implementation
- `tests/extension/McpFeatureRepository.test.ts` — Vitest tests against a tmpdir

**Modify:**
- `packages/backlog-mcp/src/contract.ts` — extend `WorkItemSchema`, `CreateItemInputShape`, `UpdateItemInputShape`
- `packages/backlog-mcp/src/adapters/types.ts` — extend `ItemPatch`, `CreateItemInput`
- `packages/backlog-mcp/src/adapters/native.ts` — read/write the new fields; auto-set `completedAt` on done transitions
- `packages/backlog-mcp/src/adapters/native.test.ts` — cover the new write fields
- `src/extension/FeatureRepository.ts` — add optional `getBody?(featureId)` to `IFeatureRepository`
- `src/extension/index.ts` — pick `McpFeatureRepository` vs `FeatureRepositoryManager` from `dataSource`; show reload prompt when `dataSource` changes
- `src/extension/KanbanPanel.ts` — delete `_mcpFeatures`, `_refreshMcpFeatures`, every `_dataSource()` branch; route `_sendFeatureContent` through `repo.getBody?.`
- `src/extension/SidebarViewProvider.ts` — delete `_mcpFeatures`, `_refreshMcpFeatures`, `_effectiveFeatures`, every `_dataSource()` branch

**Delete:**
- `src/extension/workItemSource.ts` — superseded by `McpFeatureRepository.load()`

---

## Task 1: Extend the MCP contract (zod schemas + types)

**Files:**
- Modify: `packages/backlog-mcp/src/contract.ts`
- Modify: `packages/backlog-mcp/src/adapters/types.ts`

- [ ] **Step 1: Extend `WorkItemSchema`**

In `packages/backlog-mcp/src/contract.ts`, add six fields to the schema:

```ts
export const WorkItemSchema = z.object({
  id: z.string(),
  source: z.object({ framework: z.string(), path: z.string() }),
  type: z.enum(WORK_ITEM_TYPE),
  title: z.string(),
  status: z.enum(NORM_STATUS),
  priority: z.enum(PRIORITY).nullable(),
  parent: z.string().nullable(),
  children: z.array(z.string()),
  dependsOn: z.array(z.string()),
  labels: z.array(z.string()),
  estimate: z.string().nullable(),
  acceptanceCriteria: z.array(z.string()),
  bodyRef: z.string(),
  overlay: z.record(z.unknown()).optional(),
  // NEW — frontmatter fields the native format owns; foreign adapters may omit.
  order:       z.string().nullish(),
  assignee:    z.string().nullish(),
  dueDate:     z.string().nullish(),
  created:     z.string().nullish(),
  modified:    z.string().nullish(),
  completedAt: z.string().nullish(),
})
```

- [ ] **Step 2: Extend `CreateItemInputShape` and `UpdateItemInputShape`**

Still in `contract.ts`:

```ts
export const CreateItemInputShape = {
  type:               z.enum(WORK_ITEM_TYPE),
  title:              z.string(),
  status:             z.enum(NORM_STATUS).optional(),
  priority:           z.enum(PRIORITY).nullish(),
  parent:             z.string().nullish(),
  dependsOn:          z.array(z.string()).optional(),
  labels:             z.array(z.string()).optional(),
  estimate:           z.string().nullish(),
  acceptanceCriteria: z.array(z.string()).optional(),
  body:               z.string().optional(),
  order:              z.string().nullish(),
  assignee:           z.string().nullish(),
  dueDate:            z.string().nullish(),
}

export const UpdateItemInputShape = {
  id:    z.string(),
  patch: z.object({
    title:              z.string().optional(),
    status:             z.enum(NORM_STATUS).optional(),
    priority:           z.enum(PRIORITY).nullish(),
    parent:             z.string().nullish(),
    dependsOn:          z.array(z.string()).optional(),
    labels:             z.array(z.string()).optional(),
    estimate:           z.string().nullish(),
    acceptanceCriteria: z.array(z.string()).optional(),
    order:              z.string().nullish(),
    assignee:           z.string().nullish(),
    dueDate:            z.string().nullish(),
  }),
}
```

- [ ] **Step 3: Extend `ItemPatch` and `CreateItemInput` TS types**

In `packages/backlog-mcp/src/adapters/types.ts`:

```ts
export interface CreateItemInput {
  type: WorkItemType
  title: string
  status?: NormStatus
  priority?: Priority | null
  parent?: string | null
  dependsOn?: string[]
  labels?: string[]
  estimate?: string | null
  acceptanceCriteria?: string[]
  body?: string
  // NEW
  order?: string | null
  assignee?: string | null
  dueDate?: string | null
}

export interface ItemPatch {
  title?: string
  status?: NormStatus
  priority?: Priority | null
  parent?: string | null
  dependsOn?: string[]
  labels?: string[]
  estimate?: string | null
  acceptanceCriteria?: string[]
  // NEW
  order?: string | null
  assignee?: string | null
  dueDate?: string | null
}
```

- [ ] **Step 4: Run typecheck**

```
pnpm typecheck
```
Expected: PASS. Adapters that don't yet write the new fields are still type-safe because every new field is optional.

- [ ] **Step 5: Commit**

```
git add packages/backlog-mcp/src/contract.ts packages/backlog-mcp/src/adapters/types.ts
git commit -m "feat(backlog-mcp): extend WorkItem/ItemPatch/CreateItemInput with order/assignee/dueDate/timestamps"
```

---

## Task 2: Native adapter — read/write the new frontmatter fields

**Files:**
- Modify: `packages/backlog-mcp/src/adapters/native.ts`
- Test: `packages/backlog-mcp/src/adapters/native.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/backlog-mcp/src/adapters/native.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```
pnpm vitest run packages/backlog-mcp/src/adapters/native.test.ts
```
Expected: FAIL — `order`/`assignee`/`dueDate` are `undefined` on the listed items; `updateItem` doesn't persist them; `createItem` doesn't accept them.

- [ ] **Step 3: Update `toWorkItem` to read the new fields**

In `packages/backlog-mcp/src/adapters/native.ts`, replace the `toWorkItem` function with:

```ts
function toWorkItem(folder: string, text: string, path: string): WorkItem {
  const { fm, body } = splitFrontmatter(text)
  const deps = Array.isArray(fm.dependsOn) ? (fm.dependsOn as unknown[]).map(String) : []
  return {
    id: id(folder),
    source: { framework: NS, path },
    type: (fm.type as WorkItemType) ?? 'story',
    title: titleFromBody(body, folder),
    status: (fm.status as NormStatus) ?? 'backlog',
    priority: (fm.priority as Priority) ?? null,
    parent: fm.epic ? id(String(fm.epic)) : null,
    children: [],
    dependsOn: deps.map((d) => id(stripNs(d))),
    labels: Array.isArray(fm.labels) ? (fm.labels as unknown[]).map(String) : [],
    estimate: typeof fm.estimate === 'string' ? fm.estimate : null,
    acceptanceCriteria: acceptanceCriteria(body),
    bodyRef: `${id(folder)}#body`,
    order:       typeof fm.order       === 'string' ? fm.order       : null,
    assignee:    typeof fm.assignee    === 'string' ? fm.assignee    : null,
    dueDate:     typeof fm.dueDate     === 'string' ? fm.dueDate     : null,
    created:     typeof fm.created     === 'string' ? fm.created     : null,
    modified:    typeof fm.modified    === 'string' ? fm.modified    : null,
    completedAt: typeof fm.completedAt === 'string' ? fm.completedAt : null,
  }
}
```

- [ ] **Step 4: Extend `updateItem` to persist the new fields and auto-set `completedAt`**

In `packages/backlog-mcp/src/adapters/native.ts`, replace the `updateItem` implementation:

```ts
async updateItem(ctx: AdapterContext, itemId: string, patch: ItemPatch): Promise<WorkItem> {
  const folderId = stripNs(itemId)
  const { path } = await resolveStoryPath(ctx.root, folderId)
  const text = await readFile(path, 'utf8')
  let { fm, body } = splitFrontmatter(text)

  const prevStatus = fm.status
  if (patch.status   !== undefined) fm.status   = patch.status
  if (patch.priority !== undefined) fm.priority = patch.priority
  if (patch.parent   !== undefined) fm.epic     = patch.parent ? stripNs(patch.parent) : null
  if (patch.dependsOn !== undefined) fm.dependsOn = patch.dependsOn.map((d) => stripNs(d))
  if (patch.labels   !== undefined) fm.labels   = patch.labels
  if (patch.estimate !== undefined) fm.estimate = patch.estimate
  if (patch.order    !== undefined) fm.order    = patch.order
  if (patch.assignee !== undefined) fm.assignee = patch.assignee
  if (patch.dueDate  !== undefined) fm.dueDate  = patch.dueDate
  if (patch.title    !== undefined) body = applyTitleToBody(body, patch.title)
  if (patch.acceptanceCriteria !== undefined) body = replaceAcSection(body, patch.acceptanceCriteria)

  const now = new Date().toISOString()
  fm.modified = now
  if (patch.status === 'done' && prevStatus !== 'done') fm.completedAt = now
  if (patch.status !== undefined && patch.status !== 'done') fm.completedAt = null

  await writeFile(path, `---\n${stringify(fm)}---\n${body}`, 'utf8')
  return toWorkItem(folderId, await readFile(path, 'utf8'), path)
}
```

- [ ] **Step 5: Extend `createItem` to accept the new fields**

In `packages/backlog-mcp/src/adapters/native.ts`, replace `createItem`:

```ts
async createItem(ctx: AdapterContext, input: CreateItemInput): Promise<WorkItem> {
  const folderId = await generateFolderId(ctx.root, input.title)
  const folderPath = join(featuresDir(ctx.root), folderId)
  await mkdir(folderPath, { recursive: true })
  const now = new Date().toISOString()
  const status = input.status ?? 'backlog'
  const fm: Record<string, unknown> = {
    id: folderId,
    type: input.type,
    status,
    priority: input.priority ?? null,
    epic: input.parent ? stripNs(input.parent) : null,
    order: input.order ?? null,
    assignee: input.assignee ?? null,
    dueDate: input.dueDate ?? null,
    dependsOn: (input.dependsOn ?? []).map((d) => stripNs(d)),
    labels: input.labels ?? [],
    estimate: input.estimate ?? null,
    sessions: [],
    created: now,
    modified: now,
    completedAt: status === 'done' ? now : null,
  }
  const body = buildBody(input)
  const path = join(folderPath, 'story.md')
  await writeFile(path, `---\n${stringify(fm)}---\n${body}`, 'utf8')
  return toWorkItem(folderId, await readFile(path, 'utf8'), path)
}
```

- [ ] **Step 6: Run tests to verify they pass**

```
pnpm vitest run packages/backlog-mcp/src/adapters/native.test.ts
```
Expected: PASS — all four new tests plus existing tests still pass.

- [ ] **Step 7: Commit**

```
git add packages/backlog-mcp/src/adapters/native.ts packages/backlog-mcp/src/adapters/native.test.ts
git commit -m "feat(backlog-mcp): native adapter reads/writes order/assignee/dueDate + auto completedAt"
```

---

## Task 3: Add optional `getBody` to `IFeatureRepository`

**Files:**
- Modify: `src/extension/FeatureRepository.ts:25-43`

- [ ] **Step 1: Add `getBody?` to the interface**

In `src/extension/FeatureRepository.ts`, replace the `IFeatureRepository` declaration:

```ts
export interface IFeatureRepository extends vscode.Disposable {
  readonly features: readonly Feature[]
  readonly onDidChange: vscode.Event<readonly Feature[]>
  readonly schema: SchemaType
  getFeaturesDir(): string | null
  getEffectiveRoot(): string | null
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
  /** Optional async body fetch (used by data sources that don't keep body in-memory). */
  getBody?(featureId: string): Promise<string>
}
```

- [ ] **Step 2: Run typecheck**

```
pnpm typecheck
```
Expected: PASS — `getBody` is optional, no existing implementor must change.

- [ ] **Step 3: Commit**

```
git add src/extension/FeatureRepository.ts
git commit -m "feat(repo): add optional getBody to IFeatureRepository for lazy body fetch"
```

---

## Task 4: `McpFeatureRepository` — skeleton, read path, watcher

**Files:**
- Create: `src/extension/McpFeatureRepository.ts`
- Test: `tests/extension/McpFeatureRepository.test.ts`

- [ ] **Step 1: Write failing tests for read + watcher**

Create `tests/extension/McpFeatureRepository.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// vscode is mocked in tests/setup; see existing extension tests for the pattern.
// If a setup file isn't already present, this test file may need to register
// the same mock used by other src/extension/*.test.ts files.
vi.mock('vscode', async () => await import('../setup/vscode-mock'))

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
```

- [ ] **Step 2: Run tests to verify they fail**

```
pnpm vitest run tests/extension/McpFeatureRepository.test.ts
```
Expected: FAIL — `McpFeatureRepository` does not exist.

- [ ] **Step 3: Implement the skeleton**

Create `src/extension/McpFeatureRepository.ts`:

```ts
import * as vscode from 'vscode'
import * as path from 'path'
import {
  listWorkItems,
  getItemBody,
  setBoardRoot,
  createItem,
  updateItem,
  setBody,
  deleteItem,
  type WorkItem,
} from '@kanban/backlog-mcp'
import type { Feature, FeatureStatus, FilenamePattern, Priority, SchemaType } from '../shared/types'
import { getTitleFromContent } from '../shared/types'
import { featureMatchesEpicLane } from '../shared/epicLane'
import type { CreateFeatureData, IFeatureRepository } from './FeatureRepository'

const COLUMN_STATUS = new Set<FeatureStatus>(['backlog', 'todo', 'in-progress', 'review', 'done'])

function toFeatureStatus(status: string): FeatureStatus {
  if (COLUMN_STATUS.has(status as FeatureStatus)) return status as FeatureStatus
  if (status === 'blocked') return 'todo'
  if (status === 'cancelled') return 'done'
  return 'backlog'
}

function toFeature(wi: WorkItem): Feature {
  const now = new Date().toISOString()
  return {
    id: wi.id,
    status: toFeatureStatus(wi.status),
    priority: (wi.priority ?? 'medium') as Priority,
    assignee: wi.assignee ?? null,
    epic: wi.parent,
    dueDate: wi.dueDate ?? null,
    created: wi.created ?? now,
    modified: wi.modified ?? now,
    completedAt: wi.completedAt ?? null,
    labels: wi.labels,
    order: wi.order ?? 'a0',
    workspace: null,
    content: `# ${wi.title}\n`,
    filePath: wi.source.path,
    _extraFrontmatter: {
      source: wi.source.framework,
      dependsOn: wi.dependsOn.join(','),
    },
  }
}

export class McpFeatureRepository implements IFeatureRepository {
  private _features: Feature[] = []
  private readonly _emitter = new vscode.EventEmitter<readonly Feature[]>()
  private _watcher: vscode.FileSystemWatcher | undefined
  private _root: string | null
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined

  readonly onDidChange = this._emitter.event
  readonly schema: SchemaType = 'feature'

  constructor(root: string | null) {
    this._root = root
    if (root) {
      setBoardRoot(root)
      this._installWatcher(root)
    }
  }

  get features(): readonly Feature[] { return this._features }

  getEffectiveRoot(): string | null { return this._root }

  getFeaturesDir(): string | null {
    return this._root ? path.join(this._root, '.kanban', 'features') : null
  }

  async setRoot(newRoot: string | null): Promise<void> {
    this._root = newRoot
    this._disposeWatcher()
    if (newRoot) {
      setBoardRoot(newRoot)
      this._installWatcher(newRoot)
    }
    await this.load()
  }

  setRootSync(newRoot: string | null): void {
    this._root = newRoot
    this._disposeWatcher()
    if (newRoot) {
      setBoardRoot(newRoot)
      this._installWatcher(newRoot)
    }
  }

  async load(): Promise<void> {
    if (!this._root) {
      this._features = []
      this._emitter.fire(this._features)
      return
    }
    setBoardRoot(this._root)
    const items = await listWorkItems()
    this._features = items.map(toFeature)
    this._emitter.fire(this._features)
  }

  async getBody(featureId: string): Promise<string> {
    return await getItemBody(featureId)
  }

  // Write methods land in Task 5 / Task 6.
  async createFeature(_data: CreateFeatureData): Promise<Feature> {
    throw new Error('not implemented')
  }
  async updateFeature(_featureId: string, _updates: Partial<Feature>): Promise<void> {
    throw new Error('not implemented')
  }
  async moveFeature(_featureId: string, _newStatus: string, _newOrder: number): Promise<void> {
    throw new Error('not implemented')
  }
  async deleteFeature(_featureId: string): Promise<void> {
    throw new Error('not implemented')
  }
  async moveAllFeatures(_src: string, _tgt: string, _epicLane?: string | null): Promise<void> {
    throw new Error('not implemented')
  }
  async archiveFeatures(_sourceColumnId: string): Promise<{ failedCount: number }> {
    throw new Error('not implemented')
  }
  async renameLabel(_oldName: string, _newName: string): Promise<number> {
    throw new Error('not implemented')
  }
  async deleteLabel(_labelName: string): Promise<void> {
    throw new Error('not implemented')
  }
  async migrateFilenames(_pattern: FilenamePattern): Promise<{ renamed: number; skipped: number }> {
    return { renamed: 0, skipped: 0 }
  }

  dispose(): void {
    this._disposeWatcher()
    this._emitter.dispose()
  }

  private _installWatcher(root: string): void {
    const pattern = new vscode.RelativePattern(root, '.kanban/features/**/story.md')
    const watcher = vscode.workspace.createFileSystemWatcher(pattern)
    const trigger = () => this._scheduleReload()
    watcher.onDidCreate(trigger)
    watcher.onDidChange(trigger)
    watcher.onDidDelete(trigger)
    this._watcher = watcher
  }

  private _scheduleReload(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer)
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = undefined
      void this.load()
    }, 100)
  }

  private _disposeWatcher(): void {
    this._watcher?.dispose()
    this._watcher = undefined
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer)
      this._debounceTimer = undefined
    }
  }
}
```

- [ ] **Step 4: Locate the existing vscode test mock; wire it into the new test**

Run:
```
grep -rln "vi.mock\(.vscode" tests/ | head -3
```
Use the same mock module path as existing extension tests in the `vi.mock('vscode', …)` line at the top of `tests/extension/McpFeatureRepository.test.ts`. If the existing tests don't use `vi.mock` (they rely on a globally-configured shim), remove the `vi.mock` lines and follow the same project convention.

- [ ] **Step 5: Run tests to verify they pass**

```
pnpm vitest run tests/extension/McpFeatureRepository.test.ts
```
Expected: PASS — the three skeleton tests (`load`, `getBody`, `onDidChange`).

- [ ] **Step 6: Commit**

```
git add src/extension/McpFeatureRepository.ts tests/extension/McpFeatureRepository.test.ts
git commit -m "feat(repo): McpFeatureRepository skeleton (read, watcher, getBody)"
```

---

## Task 5: `McpFeatureRepository` — write methods (create / update / move / delete)

**Files:**
- Modify: `src/extension/McpFeatureRepository.ts`
- Modify: `tests/extension/McpFeatureRepository.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/extension/McpFeatureRepository.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```
pnpm vitest run tests/extension/McpFeatureRepository.test.ts
```
Expected: FAIL — every write method currently throws.

- [ ] **Step 3: Implement `createFeature`**

In `src/extension/McpFeatureRepository.ts`, replace the placeholder `createFeature` and add a private `_idLookup`:

```ts
async createFeature(data: CreateFeatureData): Promise<Feature> {
  const title = getTitleFromContent(data.content)
  const wi = await createItem({
    type: 'story',
    title: title || 'Untitled',
    status: data.status,
    priority: data.priority,
    parent: data.epic,
    labels: data.labels,
    assignee: data.assignee,
    dueDate: data.dueDate,
    body: data.content,
  })
  await this.load()
  const feat = this._features.find(f => f.id === wi.id)
  if (!feat) throw new Error(`createFeature: lost track of created item ${wi.id}`)
  return feat
}
```

- [ ] **Step 4: Implement `updateFeature` (frontmatter + optional body)**

In `src/extension/McpFeatureRepository.ts`, replace `updateFeature`:

```ts
async updateFeature(featureId: string, updates: Partial<Feature>): Promise<void> {
  await updateItem(featureId, {
    status:   updates.status,
    priority: updates.priority,
    parent:   updates.epic,
    labels:   updates.labels,
    assignee: updates.assignee,
    dueDate:  updates.dueDate,
  })
  if (typeof updates.content === 'string') {
    await setBody(featureId, updates.content)
  }
  await this.load()
}
```

- [ ] **Step 5: Implement `moveFeature` (single update call)**

In `src/extension/McpFeatureRepository.ts`, replace `moveFeature`:

```ts
async moveFeature(featureId: string, newStatus: string, newOrder: number): Promise<void> {
  await updateItem(featureId, {
    status: newStatus as Feature['status'],
    order: String(newOrder),
  })
  await this.load()
}
```

Note: `KanbanPanel.moveFeature` already receives `newOrder` as a fractional-indexing string under the `number` type label — the existing `FeatureRepository.moveFeature` calls `String(newOrder)` for the same reason. Mirror that.

- [ ] **Step 6: Implement `deleteFeature`**

In `src/extension/McpFeatureRepository.ts`, replace `deleteFeature`:

```ts
async deleteFeature(featureId: string): Promise<void> {
  await deleteItem(featureId)
  await this.load()
}
```

- [ ] **Step 7: Run tests to verify they pass**

```
pnpm vitest run tests/extension/McpFeatureRepository.test.ts
```
Expected: PASS — all read + write tests so far.

- [ ] **Step 8: Commit**

```
git add src/extension/McpFeatureRepository.ts tests/extension/McpFeatureRepository.test.ts
git commit -m "feat(repo): McpFeatureRepository create/update/move/delete via MCP library"
```

---

## Task 6: `McpFeatureRepository` — bulk operations

**Files:**
- Modify: `src/extension/McpFeatureRepository.ts`
- Modify: `tests/extension/McpFeatureRepository.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/extension/McpFeatureRepository.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```
pnpm vitest run tests/extension/McpFeatureRepository.test.ts
```
Expected: FAIL — bulk methods still throw.

- [ ] **Step 3: Implement `moveAllFeatures`**

In `src/extension/McpFeatureRepository.ts`, replace `moveAllFeatures`:

```ts
async moveAllFeatures(
  sourceColumnId: string,
  targetColumnId: string,
  epicLane?: string | null,
): Promise<void> {
  const ids = this._features
    .filter(f => f.status === sourceColumnId)
    .filter(f => epicLane === undefined || featureMatchesEpicLane(f, epicLane))
    .map(f => f.id)
  for (const id of ids) {
    await updateItem(id, { status: targetColumnId as Feature['status'] })
  }
  await this.load()
}
```

- [ ] **Step 4: Implement `archiveFeatures`**

In `src/extension/McpFeatureRepository.ts`, replace `archiveFeatures`:

```ts
async archiveFeatures(sourceColumnId: string): Promise<{ failedCount: number }> {
  const ids = this._features.filter(f => f.status === sourceColumnId).map(f => f.id)
  let failed = 0
  for (const id of ids) {
    try {
      await updateItem(id, { status: 'done' })
    } catch {
      failed++
    }
  }
  await this.load()
  return { failedCount: failed }
}
```

- [ ] **Step 5: Implement `renameLabel` / `deleteLabel`**

In `src/extension/McpFeatureRepository.ts`, replace both methods:

```ts
async renameLabel(oldName: string, newName: string): Promise<number> {
  let count = 0
  for (const f of this._features) {
    if (!f.labels.includes(oldName)) continue
    const next = f.labels.map(l => (l === oldName ? newName : l))
    await updateItem(f.id, { labels: next })
    count++
  }
  await this.load()
  return count
}

async deleteLabel(labelName: string): Promise<void> {
  for (const f of this._features) {
    if (!f.labels.includes(labelName)) continue
    await updateItem(f.id, { labels: f.labels.filter(l => l !== labelName) })
  }
  await this.load()
}
```

- [ ] **Step 6: Run tests to verify they pass**

```
pnpm vitest run tests/extension/McpFeatureRepository.test.ts
```
Expected: PASS — bulk tests + all earlier tests still pass.

- [ ] **Step 7: Commit**

```
git add src/extension/McpFeatureRepository.ts tests/extension/McpFeatureRepository.test.ts
git commit -m "feat(repo): McpFeatureRepository bulk ops (moveAll, archive, rename/deleteLabel)"
```

---

## Task 7: Wire the repo selection in `extension/index.ts`

**Files:**
- Modify: `src/extension/index.ts:110-148`

- [ ] **Step 1: Import the new repo and add the picker**

In `src/extension/index.ts`, near the existing imports add:

```ts
import { McpFeatureRepository } from './McpFeatureRepository'
```

Then replace the `repo` line in `activate()` (currently `const repo = new FeatureRepositoryManager(context, effectiveDirs)`) with:

```ts
const initialDataSource = config.get<string>('dataSource', 'files')
const repo: IFeatureRepository = initialDataSource === 'backlog-mcp'
  ? new McpFeatureRepository(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null)
  : new FeatureRepositoryManager(context, effectiveDirs)
context.subscriptions.push(repo)
```

- [ ] **Step 2: Add a reload-on-dataSource-change prompt**

After the existing `context.subscriptions.push(launcher)` line, append:

```ts
context.subscriptions.push(
  vscode.workspace.onDidChangeConfiguration(async e => {
    if (!e.affectsConfiguration('kanban-extension.dataSource')) return
    const action = await vscode.window.showInformationMessage(
      'Kanban: data source changed. Reload window to apply.',
      'Reload Window'
    )
    if (action === 'Reload Window') {
      void vscode.commands.executeCommand('workbench.action.reloadWindow')
    }
  })
)
```

- [ ] **Step 3: Typecheck and lint**

```
pnpm typecheck && pnpm lint
```
Expected: PASS.

- [ ] **Step 4: Commit**

```
git add src/extension/index.ts
git commit -m "feat(ext): pick McpFeatureRepository when dataSource=backlog-mcp; prompt reload on change"
```

---

## Task 8: `KanbanPanel` cleanup + `getBody` integration

**Files:**
- Modify: `src/extension/KanbanPanel.ts`

- [ ] **Step 1: Delete `_mcpFeatures`, `_refreshMcpFeatures`, and the import**

In `src/extension/KanbanPanel.ts`:

1. Remove the import:
   ```ts
   import { loadBoardFeatures } from './workItemSource'
   ```
2. Remove the `private _mcpFeatures: Feature[] = []` field declaration.
3. Remove the entire `_refreshMcpFeatures` method (around line 556).
4. Remove the `if (this._dataSource() === 'backlog-mcp') void this._refreshMcpFeatures()` block in the `ready` message handler (around line 113-115).
5. Remove the `dataSource`-aware branch in the config-change listener (around line 281-285); collapse to the existing `else` body — `this._sendFeaturesToWebview()`.
6. Remove the constructor's `if (this._dataSource() === 'backlog-mcp') void this._refreshMcpFeatures()` block (around line 299-301).
7. Remove the `_dataSource()` method itself if it has no remaining callers (it won't after the next step).

- [ ] **Step 2: Simplify `_sendFeaturesToWebview`**

Replace the relevant block in `_sendFeaturesToWebview` (currently around line 596-601):

```ts
const workspaceRoot = this._repo.getEffectiveRoot()
const features = this._repo.features.map(f => ({
  ...f,
  filePath: workspaceRoot ? path.relative(workspaceRoot, f.filePath) : f.filePath,
}))
```

- [ ] **Step 3: Wire `getBody` into `_sendFeatureContent`**

Replace `_sendFeatureContent` (currently around line 437-466):

```ts
private async _sendFeatureContent(featureId: string): Promise<void> {
  const feature = this._repo.features.find(f => f.id === featureId)
  if (!feature) return

  this._currentEditingFeatureId = featureId

  const content = this._repo.getBody
    ? await this._repo.getBody(featureId)
    : feature.content

  const frontmatter: FeatureFrontmatter = {
    id: feature.id,
    status: feature.status,
    priority: feature.priority,
    assignee: feature.assignee,
    epic: feature.epic,
    dueDate: feature.dueDate,
    created: feature.created,
    modified: feature.modified,
    completedAt: feature.completedAt,
    labels: feature.labels,
    order: feature.order,
    workspace: feature.workspace,
  }

  this._lastSentEditorContent = serializeFeature({ ...feature, content })

  this._panel.webview.postMessage({
    type: 'featureContent',
    featureId: feature.id,
    content,
    frontmatter,
  })
}
```

- [ ] **Step 4: Typecheck, lint, and run the full test suite**

```
pnpm typecheck && pnpm lint && pnpm test
```
Expected: PASS — all tests still green. (Existing `KanbanPanel` tests, if any, target the file-based repo and don't care about MCP wiring.)

- [ ] **Step 5: Commit**

```
git add src/extension/KanbanPanel.ts
git commit -m "refactor(panel): remove dataSource branches; route detail body via repo.getBody"
```

---

## Task 9: `SidebarViewProvider` cleanup

**Files:**
- Modify: `src/extension/SidebarViewProvider.ts`

- [ ] **Step 1: Remove MCP plumbing**

In `src/extension/SidebarViewProvider.ts`:

1. Remove the `import { loadBoardFeatures } from './workItemSource'` line.
2. Remove `private _mcpFeatures: Feature[] = []`.
3. Remove `_dataSource()` and `_refreshMcpFeatures()`.
4. Replace `_effectiveFeatures()` body with `return this._repo.features`. Then inline it (replace every call site with `this._repo.features`) and delete the helper if it's now trivial.
5. In `onDidChange` of `_repo` (constructor), remove the `if (this._dataSource() !== 'backlog-mcp')` guard — always post the update.
6. In the configuration-change listener, drop the `backlog-mcp` branch; collapse to `this._postUpdate(this._repo.features)`.
7. In the `ready` message handler, replace the `backlog-mcp` branch with `this._postUpdate(this._repo.features)`.

- [ ] **Step 2: Typecheck and lint**

```
pnpm typecheck && pnpm lint
```
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add src/extension/SidebarViewProvider.ts
git commit -m "refactor(sidebar): remove dataSource branches; rely on repo.features"
```

---

## Task 10: Delete `workItemSource.ts` and finalize

**Files:**
- Delete: `src/extension/workItemSource.ts`

- [ ] **Step 1: Verify no remaining references**

```
grep -rn "from './workItemSource'\|loadBoardFeatures" src/ tests/
```
Expected: zero matches.

- [ ] **Step 2: Delete the file**

```
git rm src/extension/workItemSource.ts
```

- [ ] **Step 3: Run the full pipeline**

```
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
Expected: PASS at every stage.

- [ ] **Step 4: Manual verification (requires `/visual-walkthrough` per project policy)**

In a `kanban-extension.dataSource: backlog-mcp` workspace with native stories in `.kanban/features/`:

1. Open the board → cards appear with namespaced IDs (`native:*`).
2. Click a card → detail panel opens **with the real body**, not just the title.
3. Drag a card between columns → `story.md` frontmatter `status` updates on disk.
4. Edit the detail body and save → on-disk body updates.
5. Create a new story from the board → new `.kanban/features/<slug>-<date>/story.md` appears.
6. Delete a story → folder is removed.
7. Externally edit a `story.md` while the board is open → board refreshes within ~500ms.

Attach `/visual-walkthrough` evidence covering steps 2, 3, 4, 5, and 7 to the plan before marking this step done.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "chore: drop workItemSource.ts (superseded by McpFeatureRepository)"
```

---

## Self-review checklist

- [x] **Spec coverage** — every acceptance criterion in the spec maps to a task: detail view (T8 step 3), drag-and-drop (T5 step 5), detail-view edits (T5 step 4), create (T5 step 3), delete (T5 step 6), external-edit refresh (T4 step 3), no `dataSource` references in panel/sidebar (T8/T9), lint/typecheck/test (T10 step 3).
- [x] **No placeholders** — every step has concrete code or commands.
- [x] **Type consistency** — `getBody?(featureId)` signature matches between IFeatureRepository (T3), McpFeatureRepository (T4), and KanbanPanel call site (T8). `updateItem`/`createItem` signatures from contract (T1) match adapter (T2) match repo (T5/T6).
- [x] **Behavior change called out** — `dataSource` live-switching is replaced by a reload prompt (T7); spec's “Non-goals” already covers this implicitly.
