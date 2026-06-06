# Bidirectional Adapters — Full CRUD on Native Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `createItem`, `updateItem`, `setBody`, and `deleteItem` to the native adapter, expose them as MCP tools, and fix the existing `done/` path resolution bug in `setStatus` and `getBody`.

**Architecture:** All work item types (`epic`, `feature`, `story`, `task`, `spec`, `plan`) are stored as `story.md` inside a per-id folder under `.kanban/features/`. Write operations find the file via `resolveStoryPath` (which checks both `features/<id>/` and `features/done/<id>/`), update in place, and return the updated `WorkItem`. Physical folder moves remain the Kanban Board's responsibility. New optional methods on `FrameworkAdapter` keep foreign adapters read-only; a single `nativeAdapter` import in `index.ts` handles all creates.

**Tech Stack:** TypeScript, Vitest, `node:fs/promises` (`readFile`, `writeFile`, `mkdir`, `rm`, `stat`), `yaml` (stringify), Zod, `@modelcontextprotocol/sdk`

**Test commands** (run from `packages/backlog-mcp/`):
```sh
pnpm vitest run src/adapters/native.test.ts   # adapter unit tests
pnpm vitest run src/index.test.ts             # library tests
pnpm test                                     # all tests
```

---

## File Map

| File | Change |
|---|---|
| `packages/backlog-mcp/src/adapters/types.ts` | Add `CreateItemInput`, `ItemPatch` interfaces; add 4 optional methods to `FrameworkAdapter` |
| `packages/backlog-mcp/src/adapters/native.ts` | Add `resolveStoryPath`; implement `createItem`, `updateItem`, `setBody`, `deleteItem`; fix `setStatus` + `getBody` |
| `packages/backlog-mcp/src/adapters/native.test.ts` | New tests for all write operations and `done/` path resolution |
| `packages/backlog-mcp/src/contract.ts` | Add Zod input shapes and tool descriptions for 5 new tools |
| `packages/backlog-mcp/src/index.ts` | Add `createItem`, `updateItem`, `setBody`, `deleteItem` exports |
| `packages/backlog-mcp/src/index.test.ts` | Tests for new library exports and read-only guard |
| `packages/backlog-mcp/src/server.ts` | Register 5 new MCP tools |

---

## Task 1: Add `CreateItemInput` and `ItemPatch` to the adapter contract

**Files:**
- Modify: `packages/backlog-mcp/src/adapters/types.ts`

- [ ] **Step 1: Update the imports in `types.ts`**

The file currently imports only `WorkItem`. Add the extra types needed for the new interfaces:

```ts
import type { WorkItem, WorkItemType, NormStatus, Priority } from '../contract'
```

- [ ] **Step 2: Add `CreateItemInput` and `ItemPatch` interfaces**

Insert after the `AdapterContext` interface:

```ts
export interface CreateItemInput {
  type: WorkItemType
  title: string
  status?: NormStatus
  priority?: Priority | null
  parent?: string | null       // normalized id e.g. "native:my-epic"
  dependsOn?: string[]         // normalized ids
  labels?: string[]
  estimate?: string | null
  acceptanceCriteria?: string[]
  body?: string                // full markdown body; defaults to "# {title}\n"
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
}
```

- [ ] **Step 3: Add the four optional write methods to `FrameworkAdapter`**

Replace the existing interface body so it reads:

```ts
export interface FrameworkAdapter {
  name: string
  /** is this framework present under ctx.root? */
  detect(ctx: AdapterContext): Promise<boolean>
  /** read + normalize all work items under ctx.root */
  listItems(ctx: AdapterContext): Promise<WorkItem[]>
  /** full body text for an id this adapter owns */
  getBody(ctx: AdapterContext, id: string): Promise<string>
  /** set status (native is read+write; foreign adapters omit this) */
  setStatus?(ctx: AdapterContext, id: string, status: string): Promise<void>
  /** create a new item (native only); returns the created WorkItem */
  createItem?(ctx: AdapterContext, input: CreateItemInput): Promise<WorkItem>
  /** patch frontmatter (and title/AC in body); returns the updated WorkItem */
  updateItem?(ctx: AdapterContext, id: string, patch: ItemPatch): Promise<WorkItem>
  /** replace the markdown body; frontmatter unchanged */
  setBody?(ctx: AdapterContext, id: string, body: string): Promise<void>
  /** remove the item's entire folder */
  deleteItem?(ctx: AdapterContext, id: string): Promise<void>
}
```

- [ ] **Step 4: Run typecheck to verify no compile errors**

```sh
cd packages/backlog-mcp && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```sh
git add packages/backlog-mcp/src/adapters/types.ts
git commit -m "feat(backlog-mcp): add CreateItemInput, ItemPatch + write methods to FrameworkAdapter contract"
```

---

## Task 2: Fix `done/` path resolution — `resolveStoryPath`, `setStatus`, `getBody`

**Files:**
- Modify: `packages/backlog-mcp/src/adapters/native.test.ts`
- Modify: `packages/backlog-mcp/src/adapters/native.ts`

The current `storyPath()` always returns `features/<id>/story.md`, so `setStatus` and `getBody` silently fail on items already moved to `features/done/<id>/`. This task fixes that bug.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `native.test.ts` (after the existing tests):

```ts
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
```

- [ ] **Step 2: Run to verify tests fail**

```sh
cd packages/backlog-mcp && pnpm vitest run src/adapters/native.test.ts
```

Expected: 3 new failing tests. The `done/` tests fail because `storyPath` constructs the wrong path; the `missing` test fails because `readFile` throws `ENOENT`, not `"story not found"`.

- [ ] **Step 3: Add `resolveStoryPath` to `native.ts`**

Add this private function after the `featuresDir` helper (before `toWorkItem`):

```ts
async function resolveStoryPath(
  root: string,
  folderId: string
): Promise<{ path: string; folderPath: string; inDone: boolean }> {
  const base = featuresDir(root)
  const activeFolderPath = join(base, folderId)
  const doneFolderPath = join(base, 'done', folderId)
  const activePath = join(activeFolderPath, 'story.md')
  const donePath = join(doneFolderPath, 'story.md')
  try {
    await stat(activePath)
    return { path: activePath, folderPath: activeFolderPath, inDone: false }
  } catch {}
  try {
    await stat(donePath)
    return { path: donePath, folderPath: doneFolderPath, inDone: true }
  } catch {}
  throw new Error(`story not found: ${folderId}`)
}
```

- [ ] **Step 4: Update `getBody` to use `resolveStoryPath`**

Replace the current `getBody` implementation:

```ts
async getBody(ctx: AdapterContext, itemId: string) {
  const { path } = await resolveStoryPath(ctx.root, stripNs(itemId))
  const text = await readFile(path, 'utf8')
  return splitFrontmatter(text).body.trim()
},
```

- [ ] **Step 5: Update `setStatus` to use `resolveStoryPath`; remove `storyPath`**

Replace the current `setStatus` implementation:

```ts
async setStatus(ctx: AdapterContext, itemId: string, status: string) {
  const { path } = await resolveStoryPath(ctx.root, stripNs(itemId))
  const text = await readFile(path, 'utf8')
  const { fm, body } = splitFrontmatter(text)
  fm.status = status
  fm.modified = new Date().toISOString()
  await writeFile(path, `---\n${stringify(fm)}---\n${body}`, 'utf8')
},
```

Delete the `storyPath` function (it is now unused).

- [ ] **Step 6: Run tests to verify they pass**

```sh
cd packages/backlog-mcp && pnpm vitest run src/adapters/native.test.ts
```

Expected: all tests pass including the 3 new ones.

- [ ] **Step 7: Commit**

```sh
git add packages/backlog-mcp/src/adapters/native.ts \
        packages/backlog-mcp/src/adapters/native.test.ts
git commit -m "fix(backlog-mcp): resolve story path from done/ subfolder in setStatus and getBody"
```

---

## Task 3: `createItem` on native adapter (TDD)

**Files:**
- Modify: `packages/backlog-mcp/src/adapters/native.test.ts`
- Modify: `packages/backlog-mcp/src/adapters/native.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `native.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify tests fail**

```sh
cd packages/backlog-mcp && pnpm vitest run src/adapters/native.test.ts
```

Expected: 4 new failing tests (`nativeAdapter.createItem` is undefined).

- [ ] **Step 3: Add helper functions to `native.ts`**

Add `mkdir` and `rm` to the existing `node:fs/promises` import:

```ts
import { readdir, readFile, writeFile, stat, mkdir, rm } from 'node:fs/promises'
```

Add these private helpers before the `nativeAdapter` export (after `listStoryFolders`):

```ts
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

async function generateFolderId(root: string, title: string): Promise<string> {
  const date = new Date().toISOString().slice(0, 10)
  const base = `${slugify(title)}-${date}`
  const dir = featuresDir(root)
  let candidate = base
  let i = 2
  for (;;) {
    try {
      await stat(join(dir, candidate))
      candidate = `${base}-${i++}`
    } catch {
      return candidate
    }
  }
}

function buildBody(input: { title: string; body?: string; acceptanceCriteria?: string[] }): string {
  if (input.body !== undefined) return input.body
  let result = `# ${input.title}\n`
  if (input.acceptanceCriteria?.length) {
    result += `\n## Acceptance criteria\n${input.acceptanceCriteria.map((ac) => `- [ ] ${ac}`).join('\n')}\n`
  }
  return result
}
```

- [ ] **Step 4: Fix `toWorkItem` to read `type` from frontmatter**

Update the `type` line in `toWorkItem` so created items round-trip correctly:

```ts
type: (fm.type as WorkItemType) ?? 'story',
```

Add `WorkItemType` to the import from `'../contract'`:

```ts
import type { WorkItem, NormStatus, Priority, WorkItemType } from '../contract'
```

- [ ] **Step 5: Implement `createItem` on `nativeAdapter`**

Add after the `setStatus` method (inside the `nativeAdapter` object):

```ts
async createItem(ctx: AdapterContext, input: CreateItemInput): Promise<WorkItem> {
  const folderId = await generateFolderId(ctx.root, input.title)
  const folderPath = join(featuresDir(ctx.root), folderId)
  await mkdir(folderPath, { recursive: true })
  const now = new Date().toISOString()
  const fm: Record<string, unknown> = {
    id: folderId,
    type: input.type,
    status: input.status ?? 'backlog',
    priority: input.priority ?? null,
    epic: input.parent ? stripNs(input.parent) : null,
    order: null,
    dependsOn: (input.dependsOn ?? []).map((d) => stripNs(d)),
    labels: input.labels ?? [],
    estimate: input.estimate ?? null,
    sessions: [],
    created: now,
    modified: now,
  }
  const body = buildBody(input)
  const path = join(folderPath, 'story.md')
  await writeFile(path, `---\n${stringify(fm)}---\n${body}`, 'utf8')
  return toWorkItem(folderId, await readFile(path, 'utf8'), path)
},
```

Add `CreateItemInput` to the import from `'./types'`:

```ts
import type { FrameworkAdapter, AdapterContext, CreateItemInput } from './types'
```

- [ ] **Step 6: Run tests to verify they pass**

```sh
cd packages/backlog-mcp && pnpm vitest run src/adapters/native.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```sh
git add packages/backlog-mcp/src/adapters/native.ts \
        packages/backlog-mcp/src/adapters/native.test.ts
git commit -m "feat(backlog-mcp): createItem on native adapter — folder + story.md with id generation"
```

---

## Task 4: `updateItem` on native adapter (TDD)

**Files:**
- Modify: `packages/backlog-mcp/src/adapters/native.test.ts`
- Modify: `packages/backlog-mcp/src/adapters/native.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `native.test.ts`:

```ts
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
      // modified bumped
      expect(new Date(updated.source.path).getTime()).toBeGreaterThanOrEqual(0) // path still valid
      const items = await nativeAdapter.listItems({ root })
      const item = items.find((i) => i.id === 'native:upd-1')!
      expect(new Date(item.source.framework).length).toBeGreaterThan(0)
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
```

Also update the existing `node:fs/promises` import in `native.test.ts` to include `readFile`, and add the markdown helper import (new line):

```ts
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { splitFrontmatter } from './markdown'
```

- [ ] **Step 2: Run to verify tests fail**

```sh
cd packages/backlog-mcp && pnpm vitest run src/adapters/native.test.ts
```

Expected: 4 new failing tests (`nativeAdapter.updateItem` is undefined).

- [ ] **Step 3: Add `replaceAcSection` and `applyTitleToBody` helpers to `native.ts`**

Add these private helpers before the `nativeAdapter` export:

```ts
function applyTitleToBody(body: string, title: string): string {
  if (/^#\s+.+$/m.test(body)) return body.replace(/^#\s+.+$/m, `# ${title}`)
  return `# ${title}\n${body}`
}

function replaceAcSection(body: string, acs: string[]): string {
  const newSection =
    `## Acceptance criteria\n${acs.map((ac) => `- [ ] ${ac}`).join('\n')}\n`
  const parts = body.split(/^(?=## )/m)
  const idx = parts.findIndex((p) => /^## acceptance criteria\b/i.test(p))
  if (idx !== -1) {
    parts[idx] = newSection
    return parts.join('')
  }
  return body.trimEnd() + '\n\n' + newSection
}
```

- [ ] **Step 4: Implement `updateItem` on `nativeAdapter`**

Add after the `createItem` method:

```ts
async updateItem(ctx: AdapterContext, itemId: string, patch: ItemPatch): Promise<WorkItem> {
  const folderId = stripNs(itemId)
  const { path } = await resolveStoryPath(ctx.root, folderId)
  const text = await readFile(path, 'utf8')
  let { fm, body } = splitFrontmatter(text)

  if (patch.status !== undefined) fm.status = patch.status
  if (patch.priority !== undefined) fm.priority = patch.priority
  if (patch.parent !== undefined) fm.epic = patch.parent ? stripNs(patch.parent) : null
  if (patch.dependsOn !== undefined) fm.dependsOn = patch.dependsOn.map((d) => stripNs(d))
  if (patch.labels !== undefined) fm.labels = patch.labels
  if (patch.estimate !== undefined) fm.estimate = patch.estimate
  if (patch.title !== undefined) body = applyTitleToBody(body, patch.title)
  if (patch.acceptanceCriteria !== undefined) body = replaceAcSection(body, patch.acceptanceCriteria)
  fm.modified = new Date().toISOString()

  await writeFile(path, `---\n${stringify(fm)}---\n${body}`, 'utf8')
  return toWorkItem(folderId, await readFile(path, 'utf8'), path)
},
```

Add `ItemPatch` to the import from `'./types'`:

```ts
import type { FrameworkAdapter, AdapterContext, CreateItemInput, ItemPatch } from './types'
```

- [ ] **Step 5: Run tests to verify they pass**

```sh
cd packages/backlog-mcp && pnpm vitest run src/adapters/native.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```sh
git add packages/backlog-mcp/src/adapters/native.ts \
        packages/backlog-mcp/src/adapters/native.test.ts
git commit -m "feat(backlog-mcp): updateItem on native adapter — patch frontmatter, title, and AC"
```

---

## Task 5: `setBody` on native adapter (TDD)

**Files:**
- Modify: `packages/backlog-mcp/src/adapters/native.test.ts`
- Modify: `packages/backlog-mcp/src/adapters/native.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `native.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify tests fail**

```sh
cd packages/backlog-mcp && pnpm vitest run src/adapters/native.test.ts
```

Expected: 2 new failing tests.

- [ ] **Step 3: Implement `setBody` on `nativeAdapter`**

Add after the `updateItem` method:

```ts
async setBody(ctx: AdapterContext, itemId: string, newBody: string): Promise<void> {
  const { path } = await resolveStoryPath(ctx.root, stripNs(itemId))
  const text = await readFile(path, 'utf8')
  const { fm } = splitFrontmatter(text)
  await writeFile(path, `---\n${stringify(fm)}---\n${newBody}`, 'utf8')
},
```

- [ ] **Step 4: Run tests to verify they pass**

```sh
cd packages/backlog-mcp && pnpm vitest run src/adapters/native.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
git add packages/backlog-mcp/src/adapters/native.ts \
        packages/backlog-mcp/src/adapters/native.test.ts
git commit -m "feat(backlog-mcp): setBody on native adapter — replace body, preserve frontmatter"
```

---

## Task 6: `deleteItem` on native adapter (TDD)

**Files:**
- Modify: `packages/backlog-mcp/src/adapters/native.test.ts`
- Modify: `packages/backlog-mcp/src/adapters/native.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `native.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify tests fail**

```sh
cd packages/backlog-mcp && pnpm vitest run src/adapters/native.test.ts
```

Expected: 2 new failing tests.

- [ ] **Step 3: Implement `deleteItem` on `nativeAdapter`**

Add after the `setBody` method:

```ts
async deleteItem(ctx: AdapterContext, itemId: string): Promise<void> {
  const { folderPath } = await resolveStoryPath(ctx.root, stripNs(itemId))
  await rm(folderPath, { recursive: true })
},
```

- [ ] **Step 4: Run tests to verify they pass**

```sh
cd packages/backlog-mcp && pnpm vitest run src/adapters/native.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Add the conformance round-trip test**

Add a final `describe` block to `native.test.ts` that validates the full CRUD lifecycle:

```ts
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
```

- [ ] **Step 6: Run tests to verify they pass**

```sh
cd packages/backlog-mcp && pnpm vitest run src/adapters/native.test.ts
```

Expected: all tests pass including the conformance round-trip.

- [ ] **Step 7: Commit**

```sh
git add packages/backlog-mcp/src/adapters/native.ts \
        packages/backlog-mcp/src/adapters/native.test.ts
git commit -m "feat(backlog-mcp): deleteItem on native adapter + CRUD conformance round-trip test"
```

---

## Task 7: Library API additions (`index.ts`) + library tests (TDD)

**Files:**
- Modify: `packages/backlog-mcp/src/index.test.ts`
- Modify: `packages/backlog-mcp/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `index.test.ts` (the test file already has `beforeAll(() => setBoardRoot(board))` so we need our own isolated setup):

```ts
describe('library write operations', () => {
  let tmpRoot: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'pa-lib-'))
    await mkdir(join(tmpRoot, '.kanban', 'features'), { recursive: true })
    setBoardRoot(tmpRoot)
  })

  afterEach(async () => {
    setBoardRoot(board) // restore
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
```

Update the existing vitest import in `index.test.ts` to include `beforeEach` and `afterEach` (`mkdir` and `rm` are already imported):

```ts
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
```

- [ ] **Step 2: Run to verify tests fail**

```sh
cd packages/backlog-mcp && pnpm vitest run src/index.test.ts
```

Expected: 7 new failing tests (functions not exported).

- [ ] **Step 3: Add imports to `index.ts`**

Add `CreateItemInput` and `ItemPatch` to the existing imports:

```ts
import type { WorkItem, Session, DependencyGraph, FrameworkInfo, NormStatus } from './contract'
import type { CreateItemInput, ItemPatch } from './adapters/types'
```

- [ ] **Step 4: Add the four library exports to `index.ts`**

Add after the `setStatus` export:

```ts
/** Creates a new item in the native adapter (the only writable target). */
export async function createItem(input: CreateItemInput): Promise<WorkItem> {
  return nativeAdapter.createItem!(getRegistry().context(), input)
}

/** Patches frontmatter fields of an existing item (native only; foreign → throws). */
export async function updateItem(id: string, patch: ItemPatch): Promise<WorkItem> {
  const adapter = getRegistry().adapterFor(id)
  if (!adapter?.updateItem) throw new Error(`read-only or unknown adapter for "${id}"`)
  return adapter.updateItem(getRegistry().context(), id, patch)
}

/** Replaces the markdown body of an item (native only; foreign → throws). */
export async function setBody(id: string, body: string): Promise<void> {
  const adapter = getRegistry().adapterFor(id)
  if (!adapter?.setBody) throw new Error(`read-only or unknown adapter for "${id}"`)
  return adapter.setBody(getRegistry().context(), id, body)
}

/** Removes the item's entire folder (native only; foreign → throws). */
export async function deleteItem(id: string): Promise<void> {
  const adapter = getRegistry().adapterFor(id)
  if (!adapter?.deleteItem) throw new Error(`read-only or unknown adapter for "${id}"`)
  return adapter.deleteItem(getRegistry().context(), id)
}
```

- [ ] **Step 5: Run tests to verify they pass**

```sh
cd packages/backlog-mcp && pnpm vitest run src/index.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Run the full test suite**

```sh
cd packages/backlog-mcp && pnpm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```sh
git add packages/backlog-mcp/src/index.ts packages/backlog-mcp/src/index.test.ts
git commit -m "feat(backlog-mcp): createItem/updateItem/setBody/deleteItem library exports + read-only guard"
```

---

## Task 8: MCP contract additions (`contract.ts`)

**Files:**
- Modify: `packages/backlog-mcp/src/contract.ts`

No TDD here — these are declarative Zod input shapes and string constants wired in Task 9.

- [ ] **Step 1: Add `SetStatusInput` Zod shape**

In the `---- The MCP tool surface ----` section, add after `IdInput`:

```ts
export const SetStatusInput = {
  id: z.string(),
  status: z.enum(NORM_STATUS),
}
```

- [ ] **Step 2: Add `CreateItemInputShape`, `UpdateItemInputShape`, `SetBodyInput` Zod shapes**

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
  }),
}

export const SetBodyInput = {
  id:   z.string(),
  body: z.string(),
}
// deleteItem reuses IdInput
```

- [ ] **Step 3: Add 5 new tool descriptions to `TOOL_DESCRIPTIONS`**

```ts
set_status:   'Set the status of a work item by id (native adapter only).',
create_item:  'Create a new work item in the native adapter. Returns the created WorkItem.',
update_item:  'Patch frontmatter fields (and title/AC in body) of an existing work item. Returns the updated WorkItem.',
set_body:     'Replace the markdown body of a work item (frontmatter unchanged).',
delete_item:  'Delete a work item and its entire folder (native adapter only).',
```

- [ ] **Step 4: Run typecheck**

```sh
cd packages/backlog-mcp && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```sh
git add packages/backlog-mcp/src/contract.ts
git commit -m "feat(backlog-mcp): add MCP input shapes and tool descriptions for write tools"
```

---

## Task 9: Wire 5 new MCP tools in `server.ts`

**Files:**
- Modify: `packages/backlog-mcp/src/server.ts`

- [ ] **Step 1: Update the imports in `server.ts`**

Add the new input shapes to the existing import from `'./contract'`:

```ts
import {
  ListWorkItemsInput, IdInput, ListSessionsInput,
  SetStatusInput, CreateItemInputShape, UpdateItemInputShape, SetBodyInput,
  TOOL_DESCRIPTIONS
} from './contract'
```

Add the new library functions to the import from `'./index'`:

```ts
import * as lib from './index'
```

(Already a namespace import — no change needed; the new exports are automatically available as `lib.createItem`, `lib.updateItem`, `lib.setBody`, `lib.deleteItem`, `lib.setStatus`.)

- [ ] **Step 2: Register the 5 new tools**

Add these registrations after the existing `get_item_body` tool (before `dependency_graph`):

```ts
server.registerTool(
  'set_status',
  { description: TOOL_DESCRIPTIONS.set_status, inputSchema: SetStatusInput },
  async ({ id, status }) => {
    await lib.setStatus(id, status)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }] }
  }
)
server.registerTool(
  'create_item',
  { description: TOOL_DESCRIPTIONS.create_item, inputSchema: CreateItemInputShape },
  async (args) => asText(await lib.createItem(args))
)
server.registerTool(
  'update_item',
  { description: TOOL_DESCRIPTIONS.update_item, inputSchema: UpdateItemInputShape },
  async ({ id, patch }) => asText(await lib.updateItem(id, patch))
)
server.registerTool(
  'set_body',
  { description: TOOL_DESCRIPTIONS.set_body, inputSchema: SetBodyInput },
  async ({ id, body }) => {
    await lib.setBody(id, body)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }] }
  }
)
server.registerTool(
  'delete_item',
  { description: TOOL_DESCRIPTIONS.delete_item, inputSchema: IdInput },
  async ({ id }) => {
    await lib.deleteItem(id)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }] }
  }
)
```

- [ ] **Step 3: Run typecheck and full test suite**

```sh
cd packages/backlog-mcp && pnpm typecheck && pnpm test
```

Expected: typecheck clean, all tests pass.

- [ ] **Step 4: Commit**

```sh
git add packages/backlog-mcp/src/server.ts
git commit -m "feat(backlog-mcp): register set_status, create_item, update_item, set_body, delete_item MCP tools"
```

---

## Self-review checklist

- [x] `resolveStoryPath` covers `features/` and `features/done/` — ✓ Task 2
- [x] `setStatus` and `getBody` fixed for `done/` items — ✓ Task 2
- [x] `createItem`: id generation, type in frontmatter, AC in body — ✓ Task 3
- [x] `toWorkItem` reads `type` from frontmatter — ✓ Task 3
- [x] `updateItem`: title (body h1), AC (body section), all frontmatter fields — ✓ Task 4
- [x] `setBody`: replaces body, preserves frontmatter — ✓ Task 5
- [x] `deleteItem`: whole folder, from `features/` and `done/` — ✓ Task 6
- [x] Conformance round-trip test — ✓ Task 6 step 5
- [x] Library read-only guard for foreign ids — ✓ Task 7
- [x] MCP tools for all 5 operations + `set_status` — ✓ Tasks 8–9
- [x] No `done/` folder moves in the MCP layer — ✓ by design (Board's responsibility)
