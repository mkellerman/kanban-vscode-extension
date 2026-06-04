---
id: "2026-06-03-workspace-field-design"
status: "review"
priority: "medium"
created: "2026-06-03T22:00:00.000Z"
modified: "2026-06-03T22:23:00.000Z"
labels: ["git", "worktree", "agent-launcher"]
worktree: "/Users/me/GitHub/kanban-vscode-extension/.claude/worktrees/story+2026-06-03-workspace-field-design"
---

# Workspace Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `workspace: string | null` field to the Feature data model that tracks the git branch or worktree path per story, wire it through the serializer, AgentLauncher CWD selection, and webview UI badge.

**Architecture:** A single `workspace` field on `Feature` and `FeatureFrontmatter` is the source of truth. A new `parseWorkspaceValue` helper in `src/shared/workspaceContext.ts` interprets the value (`none` / `branch` / `worktree`) and drives both the card/editor badge and the AgentLauncher CWD selection. Lazy migration from the legacy `worktree` frontmatter key is handled entirely in the parser — no bulk rename needed.

**Tech Stack:** TypeScript, VS Code Extension API (`vscode.git`), React + TailwindCSS (webview), Vitest + @testing-library/react

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/shared/types.ts` | Modify | Add `workspace: string \| null` to `Feature` and `FeatureFrontmatter` |
| `src/shared/workspaceContext.ts` | Create | `WorkspaceContext` type + `parseWorkspaceValue` |
| `src/shared/featureFrontmatter.ts` | Modify | Parse `workspace` with `worktree` fallback; serialize conditionally |
| `src/extension/KanbanPanel.ts` | Modify | Include `workspace` in `featureContent` frontmatter construction |
| `src/extension/FeatureRepository.ts` | Modify | Populate `workspace` from VS Code Git API in `createFeature` |
| `src/extension/AgentLauncher.ts` | Modify | Use `parseWorkspaceValue` to select CWD; `fs.existsSync` guard |
| `l10n/bundle.l10n.en.json` | Modify | Add `panel.worktreePathMissing` warning string |
| `l10n/bundle.l10n.es.json` | Modify | Add same key (English fallback) |
| `l10n/bundle.l10n.pt.json` | Modify | Add same key (English fallback) |
| `src/webview/components/FeatureCard.tsx` | Modify | `⎇ <label>` badge |
| `src/webview/components/FeatureEditor.tsx` | Modify | `⎇ <label>` indicator near Build with AI |
| `.kanban/instructions.md` | Modify | Replace `worktree` with `workspace` in frontmatter_fields |
| `tests/shared/workspaceContext.test.ts` | Create | Unit tests for `parseWorkspaceValue` |
| `tests/shared/featureFrontmatter.test.ts` | Modify | Workspace parse/serialize/round-trip tests |
| `tests/extension/AgentLauncher.test.ts` | Modify | CWD selection tests + fixture update |
| `tests/extension/FeatureRepository.test.ts` | Modify | `createFeature` workspace population tests + fixture update |
| `tests/webview/components/FeatureCard.test.tsx` | Modify | Badge visibility tests + fixture update |
| `tests/webview/components/FeatureEditor.test.tsx` | Create | Badge visibility tests |
| `tests/webview/components/KanbanBoard.test.tsx` | Modify | `makeFeature` helper update only |

---

## Tasks

### Task 1: Add `workspace` to types and update test fixtures

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/extension/KanbanPanel.ts` (line ~409)
- Modify: `tests/shared/featureFrontmatter.test.ts`
- Modify: `tests/extension/AgentLauncher.test.ts`
- Modify: `tests/extension/FeatureRepository.test.ts`
- Modify: `tests/webview/components/FeatureCard.test.tsx`
- Modify: `tests/webview/components/KanbanBoard.test.tsx`

- [x] **Step 1: Add `workspace` to `Feature` and `FeatureFrontmatter` in `src/shared/types.ts`**

In the `Feature` interface, add after `order: string`:
```ts
workspace: string | null
```

In the `FeatureFrontmatter` interface, add after `order: string`:
```ts
workspace: string | null
```

- [x] **Step 2: Update KanbanPanel.ts `featureContent` message construction**

In `src/extension/KanbanPanel.ts` around line 409, the `frontmatter` object is constructed from `feature`. Add `workspace`:
```ts
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
  workspace: feature.workspace   // ← add this line
}
```

- [x] **Step 3: Add `workspace: null` to all test `makeFeature` helpers and inline Feature fixtures**

`tests/shared/featureFrontmatter.test.ts` — `makeFeature()` helper, add after `order: 'a1'`:
```ts
workspace: null,
```

`tests/extension/AgentLauncher.test.ts` — `REVIEW_FEATURE` and `BACKLOG_FEATURE` objects, add after `order: 'a0'` / `order: 'a1'`:
```ts
workspace: null,
```

`tests/webview/components/FeatureCard.test.tsx` — `makeFeature()` helper, add after `order: 'a0'`:
```ts
workspace: null,
```

`tests/webview/components/KanbanBoard.test.tsx` — `makeFeature()` helper, add after `order: 'a0'`:
```ts
workspace: null,
```

`tests/extension/FeatureRepository.test.ts` — `makeFeatureMd()` helper, add `workspace: null` to the YAML lines array, after the `order` line:
```ts
`order: "${order}"`,
'workspace: null',   // ← add this
'---',
```

- [x] **Step 4: Run tests to confirm TypeScript errors are gone**

Run: `npm test 2>&1 | grep -E "FAIL|PASS|error TS" | head -30`
Expected: TS errors gone; some tests may still fail (featureFrontmatter round-trip will fail because `parseFeatureFile` doesn't return `workspace` yet — that's fine, fixed in Task 3).

- [x] **Step 5: Commit**

```bash
git add src/shared/types.ts src/extension/KanbanPanel.ts \
  tests/shared/featureFrontmatter.test.ts \
  tests/extension/AgentLauncher.test.ts \
  tests/extension/FeatureRepository.test.ts \
  tests/webview/components/FeatureCard.test.tsx \
  tests/webview/components/KanbanBoard.test.tsx
git commit -m "feat: add workspace field to Feature and FeatureFrontmatter types"
```

---

### Task 2: Create `src/shared/workspaceContext.ts` and its tests

**Files:**
- Create: `src/shared/workspaceContext.ts`
- Create: `tests/shared/workspaceContext.test.ts`

- [x] **Step 1: Write the failing test file**

Create `tests/shared/workspaceContext.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseWorkspaceValue } from '../../src/shared/workspaceContext'

describe('parseWorkspaceValue', () => {
  it('returns { type: "none" } for null', () => {
    expect(parseWorkspaceValue(null)).toEqual({ type: 'none' })
  })

  it('returns branch context for a simple branch name', () => {
    expect(parseWorkspaceValue('main')).toEqual({ type: 'branch', label: 'main' })
  })

  it('returns branch context for a slash-prefixed branch name', () => {
    expect(parseWorkspaceValue('feat/my-story')).toEqual({ type: 'branch', label: 'feat/my-story' })
  })

  it('returns worktree context for a Unix absolute path', () => {
    expect(parseWorkspaceValue('/home/user/worktrees/my-story')).toEqual({
      type: 'worktree',
      path: '/home/user/worktrees/my-story',
      label: 'my-story'
    })
  })

  it('returns worktree context for a Windows absolute path', () => {
    expect(parseWorkspaceValue('C:\\worktrees\\my-story')).toEqual({
      type: 'worktree',
      path: 'C:\\worktrees\\my-story',
      label: 'my-story'
    })
  })
})
```

- [x] **Step 2: Run the test to confirm it fails**

Run: `npm test -- tests/shared/workspaceContext.test.ts 2>&1 | tail -10`
Expected: FAIL — module `../../src/shared/workspaceContext` not found

- [x] **Step 3: Create `src/shared/workspaceContext.ts`**

```ts
import * as path from 'path'

export type WorkspaceContext =
  | { type: 'none' }
  | { type: 'branch'; label: string }
  | { type: 'worktree'; path: string; label: string }

export function parseWorkspaceValue(workspace: string | null): WorkspaceContext {
  if (workspace === null) return { type: 'none' }
  if (path.isAbsolute(workspace)) {
    return { type: 'worktree', path: workspace, label: path.basename(workspace) }
  }
  return { type: 'branch', label: workspace }
}
```

- [x] **Step 4: Run the test to confirm it passes**

Run: `npm test -- tests/shared/workspaceContext.test.ts 2>&1 | tail -10`
Expected: 5/5 PASS

- [x] **Step 5: Commit**

```bash
git add src/shared/workspaceContext.ts tests/shared/workspaceContext.test.ts
git commit -m "feat: add parseWorkspaceValue helper in workspaceContext.ts"
```

---

### Task 3: Update featureFrontmatter.ts (parse + serialize workspace) + tests

**Files:**
- Modify: `src/shared/featureFrontmatter.ts`
- Modify: `tests/shared/featureFrontmatter.test.ts`

- [x] **Step 1: Write the failing tests**

In `tests/shared/featureFrontmatter.test.ts`, add a `describe('workspace')` block inside the existing `describe('parseFeatureFile', ...)` block (after the last nested describe), and workspace tests inside `describe('serializeFeature', ...)` and `describe('round-trip: serializeFeature → parseFeatureFile', ...)`:

```ts
// Inside describe('parseFeatureFile', ...) — add new nested describe:
describe('workspace', () => {
  it('parses the workspace key', () => {
    const content = makeFrontmatter({ workspace: '"main"' }) + ''
    expect(parseFeatureFile(content, FIXTURE_PATH)!.workspace).toBe('main')
  })

  it('falls back to worktree key when workspace is absent', () => {
    // makeFrontmatter does not add 'workspace', so we add 'worktree' manually
    const raw = makeFrontmatter() + ''
    const withWorktree = raw.replace('---\n# ', 'worktree: "/abs/worktree"\n---\n# ')
    // easier: use the extra-key technique below
    const content = makeFrontmatter({ worktree: '"/abs/worktree"' }) + ''
    expect(parseFeatureFile(content, FIXTURE_PATH)!.workspace).toBe('/abs/worktree')
  })

  it('returns null when both workspace and worktree are absent', () => {
    const content = makeFrontmatter() + ''
    expect(parseFeatureFile(content, FIXTURE_PATH)!.workspace).toBeNull()
  })

  it('prefers workspace over worktree when both are present', () => {
    const content = makeFrontmatter({ workspace: '"feat/new"', worktree: '"/old/path"' }) + ''
    expect(parseFeatureFile(content, FIXTURE_PATH)!.workspace).toBe('feat/new')
  })
})

// Inside describe('serializeFeature', ...) — add:
it('writes workspace when non-null', () => {
  const output = serializeFeature(makeFeature({ workspace: 'main' }))
  expect(output).toContain('workspace: "main"')
})

it('omits workspace when null', () => {
  const output = serializeFeature(makeFeature({ workspace: null }))
  expect(output).not.toContain('workspace:')
})

// Inside describe('round-trip: serializeFeature → parseFeatureFile', ...) — add:
it('round-trips a non-null workspace value', () => {
  const original = makeFeature({ workspace: '/abs/path/to/worktree' })
  const recovered = parseFeatureFile(serializeFeature(original), original.filePath)!
  expect(recovered.workspace).toBe('/abs/path/to/worktree')
})

it('round-trips a null workspace value (field absent in output)', () => {
  const original = makeFeature({ workspace: null })
  const recovered = parseFeatureFile(serializeFeature(original), original.filePath)!
  expect(recovered.workspace).toBeNull()
})
```

Note: `makeFrontmatter()` accepts extra keys via its `overrides` parameter. The `worktree` key is not a standard field but `makeFrontmatter` passes it through to YAML as-is — this tests that the parser handles unknown keys for the legacy migration.

- [x] **Step 2: Run tests to confirm they fail**

Run: `npm test -- tests/shared/featureFrontmatter.test.ts 2>&1 | tail -20`
Expected: workspace-related tests FAIL (workspace is `undefined`, not the expected values)

- [x] **Step 3: Update `parseFeatureFile` to read `workspace` with `worktree` fallback**

In `src/shared/featureFrontmatter.ts`, add `workspace` to the return object in `parseFeatureFile`. Add it after the `order` line:

```ts
// Before (in the return object):
order: getString('order') || 'a0',
content: body.trim(),
filePath

// After:
order: getString('order') || 'a0',
workspace: getString('workspace') ?? getString('worktree'),
content: body.trim(),
filePath
```

`getString` returns `null` for absent or empty keys, so the `??` chain handles all three migration cases correctly.

- [x] **Step 4: Update `serializeFeature` to conditionally include `workspace`**

In `src/shared/featureFrontmatter.ts`, update `serializeFeature`'s `frontmatterObj` to spread `workspace` only when non-null:

```ts
// Before:
const frontmatterObj: Record<string, unknown> = {
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
}

// After:
const frontmatterObj: Record<string, unknown> = {
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
  ...(feature.workspace !== null ? { workspace: feature.workspace } : {})
}
```

- [x] **Step 5: Run tests to confirm they pass**

Run: `npm test -- tests/shared/featureFrontmatter.test.ts 2>&1 | tail -20`
Expected: All tests PASS (including the new workspace ones)

- [x] **Step 6: Commit**

```bash
git add src/shared/featureFrontmatter.ts tests/shared/featureFrontmatter.test.ts
git commit -m "feat: parse workspace field with worktree fallback; omit from frontmatter when null"
```

---

### Task 4: Populate `workspace` in `FeatureRepository.createFeature` + tests

**Files:**
- Modify: `src/extension/FeatureRepository.ts`
- Modify: `tests/extension/FeatureRepository.test.ts`

- [x] **Step 1: Add `mockGetExtension` to the existing vscode mock**

In `tests/extension/FeatureRepository.test.ts`, the `vi.hoisted` block currently captures watcher callbacks. Add a `mockGetExtension` fn to it:

```ts
const { mockCreateFileSystemWatcher, simulateChange, mockGetExtension } = vi.hoisted(() => {
  // ...existing watcher setup...
  const mockGetExtension = vi.fn(() => undefined as unknown)
  return { mockCreateFileSystemWatcher, simulateChange, mockGetExtension }
})
```

Add `extensions` to the `vi.mock('vscode', ...)` factory (alongside the existing `workspace`, `EventEmitter`, etc.):

```ts
vi.mock('vscode', () => ({
  workspace: { /* existing */ },
  EventEmitter: /* existing */,
  Uri: /* existing */,
  FileType: /* existing */,
  RelativePattern: /* existing */,
  extensions: { getExtension: mockGetExtension }   // ← add this
}))
```

Also add `mockGetExtension.mockReset()` (or `vi.clearAllMocks()` if that's already there) to the global `beforeEach`:

```ts
beforeEach(() => {
  mockGetExtension.mockReset()
})
```

- [x] **Step 2: Write failing tests for `createFeature` workspace population**

Add a new `describe` block after the existing `describe('FeatureRepository.createFeature()', ...)`:

```ts
describe('FeatureRepository.createFeature() — workspace population', () => {
  let memFs: MemoryFs

  beforeEach(() => {
    memFs = new MemoryFs()
    vi.useFakeTimers()
    mockGetExtension.mockReset()
  })
  afterEach(() => { vi.useRealTimers() })

  it('sets workspace to the current branch when Git API returns a matching repo', async () => {
    mockGetExtension.mockReturnValue({
      exports: {
        getAPI: () => ({
          repositories: [{
            rootUri: { fsPath: '/workspace' },
            state: { HEAD: { name: 'feat/my-story' } }
          }]
        })
      }
    })
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    const feature = await repo.createFeature({
      status: 'backlog', priority: 'medium', content: '# Test',
      assignee: null, epic: null, dueDate: null, labels: []
    })
    expect(feature.workspace).toBe('feat/my-story')
  })

  it('sets workspace to null when getExtension returns undefined (API unavailable)', async () => {
    mockGetExtension.mockReturnValue(undefined)
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    const feature = await repo.createFeature({
      status: 'backlog', priority: 'medium', content: '# Test',
      assignee: null, epic: null, dueDate: null, labels: []
    })
    expect(feature.workspace).toBeNull()
  })

  it('sets workspace to null when no repository root contains the features dir', async () => {
    mockGetExtension.mockReturnValue({
      exports: {
        getAPI: () => ({
          repositories: [{
            rootUri: { fsPath: '/other/dir' },
            state: { HEAD: { name: 'main' } }
          }]
        })
      }
    })
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    const feature = await repo.createFeature({
      status: 'backlog', priority: 'medium', content: '# Test',
      assignee: null, epic: null, dueDate: null, labels: []
    })
    expect(feature.workspace).toBeNull()
  })

  it('sets workspace to null when HEAD.name is undefined', async () => {
    mockGetExtension.mockReturnValue({
      exports: {
        getAPI: () => ({
          repositories: [{
            rootUri: { fsPath: '/workspace' },
            state: { HEAD: undefined }
          }]
        })
      }
    })
    const repo = new FeatureRepository(makeContext(), memFs as unknown as FsAdapter)
    const feature = await repo.createFeature({
      status: 'backlog', priority: 'medium', content: '# Test',
      assignee: null, epic: null, dueDate: null, labels: []
    })
    expect(feature.workspace).toBeNull()
  })
})
```

- [x] **Step 3: Run tests to confirm they fail**

Run: `npm test -- tests/extension/FeatureRepository.test.ts 2>&1 | tail -20`
Expected: New workspace tests FAIL (feature.workspace is undefined)

- [x] **Step 4: Implement workspace population in `FeatureRepository.createFeature`**

Add a minimal inline type near the top of `src/extension/FeatureRepository.ts` (after the imports):

```ts
interface GitRepository {
  rootUri: vscode.Uri
  state: { HEAD?: { name?: string } }
}
interface GitAPI { repositories: GitRepository[] }
interface GitExtension { getAPI(version: number): GitAPI }
```

In the `createFeature` method, after the `now` constant and before constructing the `feature` object, add:

```ts
const featuresDir = this.getFeaturesDir()
const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports
const matchingRepo = gitExt?.getAPI(1).repositories.find(
  r => featuresDir != null && featuresDir.startsWith(r.rootUri.fsPath)
)
const workspace = matchingRepo?.state.HEAD?.name ?? null
```

Then include `workspace` in the `feature` object literal (after `order`):

```ts
const feature: Feature = {
  id: uniqueName,
  status: data.status,
  priority: data.priority,
  assignee: data.assignee,
  epic: data.epic ? data.epic.trim() || null : null,
  dueDate: data.dueDate,
  created: now,
  modified: now,
  completedAt: data.status === 'done' ? now : null,
  labels: data.labels,
  order: newOrder,
  workspace,            // ← add this line
  content: data.content,
  filePath
}
```

- [x] **Step 5: Run tests to confirm they pass**

Run: `npm test -- tests/extension/FeatureRepository.test.ts 2>&1 | tail -20`
Expected: All tests PASS

- [x] **Step 6: Commit**

```bash
git add src/extension/FeatureRepository.ts tests/extension/FeatureRepository.test.ts
git commit -m "feat: populate workspace from VS Code Git API in createFeature"
```

---

### Task 5: Update AgentLauncher CWD selection + l10n + tests

**Files:**
- Modify: `src/extension/AgentLauncher.ts`
- Modify: `l10n/bundle.l10n.en.json`
- Modify: `l10n/bundle.l10n.es.json`
- Modify: `l10n/bundle.l10n.pt.json`
- Modify: `tests/extension/AgentLauncher.test.ts`

- [x] **Step 1: Add warning key to all three l10n files**

In `l10n/bundle.l10n.en.json`, add after the `panel.aiRequiresTrust` entry:
```json
"panel.worktreePathMissing": "Worktree path not found — launching in workspace root",
```

In `l10n/bundle.l10n.es.json` and `l10n/bundle.l10n.pt.json`, add the same key with the English string as the value (translation team can update later).

- [x] **Step 2: Write failing tests**

In `tests/extension/AgentLauncher.test.ts`, add an `fs` mock and new test cases inside `describe('AgentLauncher.launch()', ...)`. The test file already has `vi.mock('fs')`. Set up the `existsSync` mock explicitly:

Add at the top (in the `vi.hoisted` block or just after the existing mocks):
```ts
import * as fs from 'fs'
```
(The `vi.mock('fs')` already auto-mocks fs.)

Add a feature fixture with an absolute worktree path:
```ts
const WORKTREE_FEATURE: Feature = {
  id: 'wt-feat',
  status: 'in-progress',
  priority: 'medium',
  assignee: null,
  epic: null,
  dueDate: null,
  created: '2026-01-01T00:00:00.000Z',
  modified: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  labels: [],
  order: 'a2',
  workspace: '/worktrees/wt-feat',
  content: '# Worktree Feature',
  filePath: '/workspace/.kanban/features/wt-feat.md'
}
```

Add new test cases inside `describe('AgentLauncher.launch()', ...)`:
```ts
it('uses worktree path as CWD when workspace is an absolute path and directory exists', () => {
  vi.mocked(fs.existsSync).mockReturnValueOnce(true)
  const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
  launcher.launch(WORKTREE_FEATURE, 'claude', 'default')
  const opts = mockCreateTerminal.mock.calls[0][0]
  expect(opts.cwd).toBe('/worktrees/wt-feat')
})

it('falls back to workspace root and shows warning when worktree directory is missing', () => {
  vi.mocked(fs.existsSync).mockReturnValueOnce(false)
  const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
  launcher.launch(WORKTREE_FEATURE, 'claude', 'default')
  const opts = mockCreateTerminal.mock.calls[0][0]
  expect(opts.cwd).toBe('/workspace')
  expect(mockShowWarningMessage).toHaveBeenCalledOnce()
})

it('uses workspace root as CWD when workspace is a branch name', () => {
  const branchFeature = { ...REVIEW_FEATURE, workspace: 'feat/my-story' }
  const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
  launcher.launch(branchFeature, 'claude', 'default')
  const opts = mockCreateTerminal.mock.calls[0][0]
  expect(opts.cwd).toBe('/workspace')
})

it('uses workspace root as CWD when workspace is null', () => {
  const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
  launcher.launch(REVIEW_FEATURE, 'claude', 'default')  // REVIEW_FEATURE.workspace = null
  const opts = mockCreateTerminal.mock.calls[0][0]
  expect(opts.cwd).toBe('/workspace')
})
```

- [x] **Step 3: Run tests to confirm they fail**

Run: `npm test -- tests/extension/AgentLauncher.test.ts 2>&1 | tail -20`
Expected: New workspace-CWD tests FAIL

- [x] **Step 4: Update `AgentLauncher.ts`**

Add imports at the top of `src/extension/AgentLauncher.ts`:
```ts
import * as fs from 'fs'
import { parseWorkspaceValue } from '../shared/workspaceContext'
```

In the `launch` method, replace the last `launchAgentTerminal` call's `cwd` argument. After `workspaceRoot` is computed, add the CWD selection logic:

```ts
// After: const workspaceRoot = effectiveRoot ?? ... ?? null

const wsCtx = parseWorkspaceValue(feature.workspace ?? null)
let cwd: string | undefined
if (wsCtx.type === 'worktree') {
  if (fs.existsSync(wsCtx.path)) {
    cwd = wsCtx.path
  } else {
    vscode.window.showWarningMessage(t('panel.worktreePathMissing'))
    cwd = workspaceRoot ?? undefined
  }
} else {
  cwd = workspaceRoot ?? undefined
}
```

Then update the `launchAgentTerminal` call to use `cwd` instead of `workspaceRoot ?? undefined`:
```ts
launchAgentTerminal(
  agent || 'claude',
  permissionMode || 'default',
  prompt,
  cwd,              // ← was: workspaceRoot ?? undefined
  terminalTitle
)
```

- [x] **Step 5: Run tests to confirm they pass**

Run: `npm test -- tests/extension/AgentLauncher.test.ts 2>&1 | tail -20`
Expected: All tests PASS

- [x] **Step 6: Commit**

```bash
git add src/extension/AgentLauncher.ts l10n/bundle.l10n.en.json l10n/bundle.l10n.es.json l10n/bundle.l10n.pt.json tests/extension/AgentLauncher.test.ts
git commit -m "feat: use worktree path as CWD in AgentLauncher when workspace is absolute path"
```

---

### Task 6: `FeatureCard` workspace badge + tests

**Files:**
- Modify: `src/webview/components/FeatureCard.tsx`
- Modify: `tests/webview/components/FeatureCard.test.tsx`

- [x] **Step 1: Write failing tests**

In `tests/webview/components/FeatureCard.test.tsx`, add a new `describe` block at the end:

```ts
describe('FeatureCard — workspace badge', () => {
  it('shows a ⎇ badge when workspace is a branch name', () => {
    setSettings()
    render(<FeatureCard feature={makeFeature({ workspace: 'feat/my-story' })} onClick={() => {}} />)
    expect(screen.getByText('⎇ feat/my-story')).toBeInTheDocument()
  })

  it('shows a ⎇ badge with basename when workspace is a worktree path', () => {
    setSettings()
    render(<FeatureCard feature={makeFeature({ workspace: '/worktrees/my-story' })} onClick={() => {}} />)
    expect(screen.getByText('⎇ my-story')).toBeInTheDocument()
  })

  it('shows no ⎇ badge when workspace is null', () => {
    setSettings()
    render(<FeatureCard feature={makeFeature({ workspace: null })} onClick={() => {}} />)
    expect(screen.queryByText(/⎇/)).not.toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run tests to confirm they fail**

Run: `npm test -- tests/webview/components/FeatureCard.test.tsx 2>&1 | tail -20`
Expected: workspace badge tests FAIL (badge not found)

- [x] **Step 3: Add the badge to `FeatureCard.tsx`**

In `src/webview/components/FeatureCard.tsx`, add this import at the top:
```ts
import { parseWorkspaceValue } from '../../shared/workspaceContext'
```

Add the badge computation near the top of the `FeatureCard` component body (after `epicTheme`):
```ts
const workspaceCtx = parseWorkspaceValue(feature.workspace ?? null)
```

Add the badge inside the card, after the Epic row and before the Labels row:
```tsx
{/* Workspace badge */}
{workspaceCtx.type !== 'none' && (
  <div className="flex items-center gap-1 mb-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
    <span>⎇ {workspaceCtx.label}</span>
  </div>
)}
```

The badge text is rendered as a single text node `"⎇ {label}"` so `screen.getByText('⎇ feat/my-story')` will match. Make sure the JSX renders `⎇ {workspaceCtx.label}` as one expression, not split across elements:
```tsx
<span>⎇ {workspaceCtx.label}</span>
```

- [x] **Step 4: Run tests to confirm they pass**

Run: `npm test -- tests/webview/components/FeatureCard.test.tsx 2>&1 | tail -20`
Expected: All tests PASS

- [x] **Step 5: Commit**

```bash
git add src/webview/components/FeatureCard.tsx tests/webview/components/FeatureCard.test.tsx
git commit -m "feat: add workspace branch/worktree badge to FeatureCard"
```

---

### Task 7: `FeatureEditor` workspace indicator + tests

**Files:**
- Modify: `src/webview/components/FeatureEditor.tsx`
- Create: `tests/webview/components/FeatureEditor.test.tsx`

- [x] **Step 1: Write the failing test file**

Create `tests/webview/components/FeatureEditor.test.tsx`. TipTap's `useEditor` doesn't work in jsdom — mock it:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FeatureEditor } from '../../../src/webview/components/FeatureEditor'
import { useStore } from '../../../src/webview/store'
import type { CardDisplaySettings, FeatureFrontmatter } from '../../../src/shared/types'

// ---------------------------------------------------------------------------
// Mock TipTap (doesn't work in jsdom)
// ---------------------------------------------------------------------------
vi.mock('@tiptap/react', () => ({
  useEditor: () => null,
  EditorContent: () => null
}))
vi.mock('@tiptap/starter-kit', () => ({ default: {} }))
vi.mock('@tiptap/extension-placeholder', () => ({ default: { configure: () => ({}) } }))
vi.mock('tiptap-markdown', () => ({ Markdown: { configure: () => ({}) } }))

// ---------------------------------------------------------------------------
// Mock vscode postMessage
// ---------------------------------------------------------------------------
const { mockPostMessage } = vi.hoisted(() => ({ mockPostMessage: vi.fn() }))
vi.mock('../../../src/webview/vscodeApi', () => ({ vscode: { postMessage: mockPostMessage } }))

// ---------------------------------------------------------------------------
// Store reset
// ---------------------------------------------------------------------------
const initialState = useStore.getState()
beforeEach(() => { useStore.setState(initialState, true) })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const defaultSettings: CardDisplaySettings = {
  showPriorityBadges: true,
  showAssignee: true,
  showDueDate: true,
  showLabels: true,
  showEpic: true,
  showBuildWithAI: true,
  showFileName: false,
  compactMode: false,
  markdownEditorMode: false,
  hideScrollbar: false,
  defaultPriority: 'medium',
  defaultStatus: 'backlog'
}

function setSettings(overrides: Partial<CardDisplaySettings> = {}) {
  useStore.setState({ cardSettings: { ...defaultSettings, ...overrides } })
}

function makeFrontmatter(overrides: Partial<FeatureFrontmatter> = {}): FeatureFrontmatter {
  return {
    id: 'feat-1',
    status: 'in-progress',
    priority: 'medium',
    assignee: null,
    epic: null,
    dueDate: null,
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    labels: [],
    order: 'a0',
    workspace: null,
    ...overrides
  }
}

const noOp = () => {}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('FeatureEditor — workspace indicator', () => {
  it('shows ⎇ indicator when workspace is a branch name', () => {
    setSettings()
    render(
      <FeatureEditor
        featureId="feat-1"
        content="# Test"
        frontmatter={makeFrontmatter({ workspace: 'feat/my-story' })}
        onSave={noOp}
        onClose={noOp}
        onDelete={noOp}
        onOpenFile={noOp}
        onStartWithAI={noOp}
      />
    )
    expect(screen.getByText('⎇ feat/my-story')).toBeInTheDocument()
  })

  it('shows ⎇ indicator with basename when workspace is a worktree path', () => {
    setSettings()
    render(
      <FeatureEditor
        featureId="feat-1"
        content="# Test"
        frontmatter={makeFrontmatter({ workspace: '/worktrees/my-story' })}
        onSave={noOp}
        onClose={noOp}
        onDelete={noOp}
        onOpenFile={noOp}
        onStartWithAI={noOp}
      />
    )
    expect(screen.getByText('⎇ my-story')).toBeInTheDocument()
  })

  it('shows no ⎇ indicator when workspace is null', () => {
    setSettings()
    render(
      <FeatureEditor
        featureId="feat-1"
        content="# Test"
        frontmatter={makeFrontmatter({ workspace: null })}
        onSave={noOp}
        onClose={noOp}
        onDelete={noOp}
        onOpenFile={noOp}
        onStartWithAI={noOp}
      />
    )
    expect(screen.queryByText(/⎇/)).not.toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run tests to confirm they fail**

Run: `npm test -- tests/webview/components/FeatureEditor.test.tsx 2>&1 | tail -20`
Expected: FAIL — `⎇` text not found in rendered output

- [x] **Step 3: Add the workspace indicator to `FeatureEditor.tsx`**

Add this import at the top of `src/webview/components/FeatureEditor.tsx`:
```ts
import { parseWorkspaceValue } from '../../shared/workspaceContext'
```

In the `FeatureEditor` component body, add a workspace context derivation (after `const [confirmingDelete, ...]`):
```ts
const workspaceCtx = parseWorkspaceValue(currentFrontmatter.workspace ?? null)
```

In the JSX header area, add the indicator between the `AIDropdown` and the close button. The header's right side currently is:
```tsx
<div className="flex items-center gap-2">
  {cardSettings.showBuildWithAI && <AIDropdown onSelect={onStartWithAI} />}
  <button onClick={onClose} ...>
    <X size={18} />
  </button>
</div>
```

Update it to:
```tsx
<div className="flex items-center gap-2">
  {cardSettings.showBuildWithAI && <AIDropdown onSelect={onStartWithAI} />}
  {workspaceCtx.type !== 'none' && (
    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 select-none">
      ⎇ {workspaceCtx.label}
    </span>
  )}
  <button onClick={onClose} ...>
    <X size={18} />
  </button>
</div>
```

- [x] **Step 4: Run tests to confirm they pass**

Run: `npm test -- tests/webview/components/FeatureEditor.test.tsx 2>&1 | tail -20`
Expected: All 3 tests PASS

- [x] **Step 5: Commit**

```bash
git add src/webview/components/FeatureEditor.tsx tests/webview/components/FeatureEditor.test.tsx
git commit -m "feat: add workspace indicator near Build with AI in FeatureEditor"
```

---

### Task 8: Update `.kanban/instructions.md`

**Files:**
- Modify: `.kanban/instructions.md`

- [x] **Step 1: Replace `worktree` with `workspace` in frontmatter_fields**

In `.kanban/instructions.md`, in the `frontmatter_fields` list, change:
```yaml
  - worktree
```
to:
```yaml
  - workspace
```

- [x] **Step 2: Run full test suite to confirm everything passes**

Run: `npm test 2>&1 | tail -20`
Expected: All tests PASS

- [x] **Step 3: Commit**

```bash
git add .kanban/instructions.md
git commit -m "docs: update frontmatter_fields — rename worktree to workspace in kanban instructions"
```

---

## Test Plan

| Acceptance Criterion | Verified By |
|---|---|
| `workspace: string \| null` on `Feature` and `FeatureFrontmatter` | TypeScript compilation; `featureFrontmatter.test.ts` round-trip |
| `parseFeatureFile` reads `workspace`; falls back to `worktree`; null otherwise | `featureFrontmatter.test.ts` — workspace describe block |
| `serializeFeature` writes `workspace` when non-null, omits when null | `featureFrontmatter.test.ts` — serializeFeature tests |
| `createFeature` sets `workspace` from Git API branch; null fallback | `FeatureRepository.test.ts` — workspace population describe block |
| `parseWorkspaceValue` covers null / branch / Unix path / Windows path | `workspaceContext.test.ts` |
| `FeatureCard` shows `⎇ <label>` badge when non-null; hidden when null | `FeatureCard.test.tsx` — workspace badge describe block |
| `FeatureEditor` shows `⎇ <label>` indicator; hidden when null | `FeatureEditor.test.tsx` |
| Editor save roundtrip preserves `workspace` | Follows from `FeatureFrontmatter.workspace` field inclusion in featureContent message |
| `AgentLauncher` uses worktree path as CWD when path exists | `AgentLauncher.test.ts` — worktree CWD tests |
| Missing worktree path → warning + workspace root fallback | `AgentLauncher.test.ts` — missing path test |
| Branch/null workspace → uses workspace root (existing behavior) | `AgentLauncher.test.ts` — branch and null tests |
| `.kanban/instructions.md` uses `workspace` not `worktree` | Manual diff |

## Out of Scope

- Editing `workspace` in the UI (it is set programmatically and displayed read-only)
- A `showWorkspace` settings toggle
- Any bulk migration of existing `.md` files (lazy migration in parser handles this)
- Translation of the worktree-missing warning into Spanish/Portuguese

## Dependencies

None — this is a self-contained feature. All acceptance criteria are testable within this repo.
