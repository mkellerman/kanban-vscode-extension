# Lane-Level Scrum Master Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Scrum Master" menu item to each Kanban column's three-dots header menu that launches an agent terminal with a lane-level review prompt covering all currently-visible (filtered) stories in that lane.

**Architecture:** The webview sends a new `laneAction` message carrying the filtered feature IDs for that column. `KanbanPanel` resolves IDs to `Feature` objects and calls a new `AgentLauncher.launchLane()` method, which uses a new `buildLanePrompt()` function following the same 3-level template resolution as the existing per-card `buildPrompt()`. Five bundled lane prompt files provide scrum-master guidance tailored to each lifecycle stage.

**Tech Stack:** TypeScript, React (Tailwind CSS), Vitest, VS Code Extension API, `@vscode/l10n` for i18n

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/shared/types.ts` | Modify | Add `laneAction` variant to `WebviewMessage` |
| `src/extension/ai/promptBuilder.ts` | Modify | Add `buildLanePrompt()` function |
| `src/extension/AgentLauncher.ts` | Modify | Add `launchLane()` method |
| `src/extension/KanbanPanel.ts` | Modify | Handle `laneAction` message |
| `src/webview/components/KanbanColumn.tsx` | Modify | Add `onLaneAction` prop + Scrum Master menu item |
| `src/webview/components/KanbanBoard.tsx` | Modify | Add `handleLaneAction` handler, pass prop |
| `l10n/bundle.l10n.en.json` | Modify | Add `column.scrumMaster` English string |
| `l10n/bundle.l10n.es.json` | Modify | Add `column.scrumMaster` Spanish string |
| `l10n/bundle.l10n.pt.json` | Modify | Add `column.scrumMaster` Portuguese string |
| `prompts/backlog-lane.md` | Create | Bundled backlog lane prompt |
| `prompts/todo-lane.md` | Create | Bundled todo lane prompt |
| `prompts/in-progress-lane.md` | Create | Bundled in-progress lane prompt |
| `prompts/review-lane.md` | Create | Bundled review lane prompt |
| `prompts/done-lane.md` | Create | Bundled done lane prompt |
| `tests/extension/ai/promptBuilder.test.ts` | Modify | Tests for `buildLanePrompt` |
| `tests/extension/AgentLauncher.test.ts` | Modify | Tests for `launchLane` |
| `tests/extension/KanbanPanel.laneAction.test.ts` | Create | Tests for `laneAction` panel handler |

---

## Task 1: Add `laneAction` to `WebviewMessage`

**Files:**
- Modify: `src/shared/types.ts:144`

- [ ] **Step 1: Add the new message variant**

Open `src/shared/types.ts`. The `WebviewMessage` union currently ends with:
```ts
| { type: 'startWithAI'; agent?: AIAgent; permissionMode?: AIPermissionMode }
```

Append the new variant after that line:
```ts
| { type: 'laneAction'; columnId: string; featureIds: string[] }
```

- [ ] **Step 2: Run typecheck to confirm no errors**

```bash
pnpm typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add laneAction to WebviewMessage type"
```

---

## Task 2: Write failing tests for `buildLanePrompt`

**Files:**
- Modify: `tests/extension/ai/promptBuilder.test.ts`

- [ ] **Step 1: Add `buildLanePrompt` import and test fixtures**

At the top of `tests/extension/ai/promptBuilder.test.ts`, update the imports section. Change:
```ts
import { buildPrompt } from '../../../src/extension/ai/promptBuilder'
```
to:
```ts
import { buildPrompt, buildLanePrompt } from '../../../src/extension/ai/promptBuilder'
import type { Feature } from '../../../src/shared/types'
```

Then add two fixture Features after the existing column constants (around line 37). Add anywhere before the first `describe` block:
```ts
const FEAT_A: Feature = {
  id: 'feat-a', status: 'backlog', priority: 'medium', assignee: null, epic: null,
  dueDate: null, created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z',
  completedAt: null, labels: [], order: 'a0', content: '# Feature A',
  filePath: '/workspace/.kanban/features/feat-a.md'
}

const FEAT_B: Feature = {
  id: 'feat-b', status: 'backlog', priority: 'high', assignee: null, epic: null,
  dueDate: null, created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z',
  completedAt: null, labels: [], order: 'a1', content: '# Feature B',
  filePath: '/workspace/.kanban/features/feat-b.md'
}
```

- [ ] **Step 2: Append the new test suites at the end of the file**

```ts
// ---------------------------------------------------------------------------
// buildLanePrompt — variable substitution
// ---------------------------------------------------------------------------

describe('buildLanePrompt — variable substitution', () => {
  it('substitutes {{columnName}}, {{count}}, and {{featurePaths}} from the bundled template', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('backlog-lane.md')) return '{{columnName}} {{count}}\n{{featurePaths}}'
      throw new Error('ENOENT')
    })
    const result = buildLanePrompt([FEAT_A, FEAT_B], backlogColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(result).toContain('Backlog')
    expect(result).toContain('2')
    expect(result).toContain('.kanban/features/feat-a.md')
    expect(result).toContain('.kanban/features/feat-b.md')
  })

  it('makes featurePaths relative to workspaceRoot when workspaceRoot is provided', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('backlog-lane.md')) return '{{featurePaths}}'
      throw new Error('ENOENT')
    })
    const result = buildLanePrompt([FEAT_A], backlogColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    // relative path: .kanban/features/feat-a.md (no leading /workspace/)
    expect(result).toContain('.kanban/features/feat-a.md')
    expect(result).not.toContain('/workspace/.kanban')
  })

  it('uses absolute featurePaths when workspaceRoot is null', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('should not be called') })
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('backlog-lane.md')) return '{{featurePaths}}'
      throw new Error('ENOENT')
    })
    const result = buildLanePrompt([FEAT_A], backlogColumn, EXTENSION_ROOT, null)
    expect(result).toContain('/workspace/.kanban/features/feat-a.md')
  })

  it('{{featurePaths}} lists each file on its own line', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('backlog-lane.md')) return '{{featurePaths}}'
      throw new Error('ENOENT')
    })
    const result = buildLanePrompt([FEAT_A, FEAT_B], backlogColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    const lines = result.split('\n')
    expect(lines).toContain('.kanban/features/feat-a.md')
    expect(lines).toContain('.kanban/features/feat-b.md')
  })
})

// ---------------------------------------------------------------------------
// buildLanePrompt — resolution chain
// ---------------------------------------------------------------------------

describe('buildLanePrompt — resolution chain', () => {
  it('Level 1: local .kanban/instructions/{columnId}-lane.md wins over bundled', () => {
    vi.mocked(fs.realpathSync).mockImplementation((p) => String(p))
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const str = String(p)
      if (str.includes('.kanban/instructions') && str.includes('backlog-lane')) {
        return 'Local lane: {{columnName}}'
      }
      if (str.endsWith('backlog-lane.md')) return 'Bundled lane'
      throw new Error('ENOENT')
    })
    const result = buildLanePrompt([FEAT_A], backlogColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(result).toContain('Local lane: Backlog')
    expect(result).not.toContain('Bundled lane')
  })

  it('Level 2: bundled prompts/{columnId}-lane.md used when no local override', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('backlog-lane.md')) return 'Bundled lane: {{columnName}}'
      throw new Error('ENOENT')
    })
    const result = buildLanePrompt([FEAT_A], backlogColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(result).toContain('Bundled lane: Backlog')
  })

  it('Level 3: generic fallback used when no local or bundled template exists', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
    const result = buildLanePrompt([FEAT_A], backlogColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(result).toContain('Backlog')
    expect(result).toContain('.kanban/features/feat-a.md')
  })

  it('skips local file lookup when workspaceRoot is null', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('should not be called') })
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('backlog-lane.md')) return 'Bundled: {{columnName}}'
      throw new Error('ENOENT')
    })
    const result = buildLanePrompt([FEAT_A], backlogColumn, EXTENSION_ROOT, null)
    expect(result).toContain('Bundled: Backlog')
    expect(vi.mocked(fs.realpathSync)).not.toHaveBeenCalled()
  })

  it('../secret column ID skips local file lookup and uses fallback', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('should not be called') })
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
    const badColumn: KanbanColumn = { id: '../secret', name: 'Bad', color: '' }
    buildLanePrompt([FEAT_A], badColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(vi.mocked(fs.realpathSync)).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
pnpm test -- tests/extension/ai/promptBuilder.test.ts
```
Expected: FAIL — `buildLanePrompt is not a function` (it doesn't exist yet)

---

## Task 3: Implement `buildLanePrompt`

**Files:**
- Modify: `src/extension/ai/promptBuilder.ts`

- [ ] **Step 1: Add `Feature` to the type import**

Change line 1 from:
```ts
import type { KanbanColumn } from '../../shared/types'
```
to:
```ts
import type { Feature, KanbanColumn } from '../../shared/types'
```

- [ ] **Step 2: Add `buildLanePrompt` after `buildPrompt`**

Append this function at the end of `src/extension/ai/promptBuilder.ts`:
```ts
export function buildLanePrompt(
  features: Feature[],
  column: KanbanColumn,
  extensionRoot: string,
  workspaceRoot: string | null
): string {
  const featurePaths = features.map(f =>
    workspaceRoot ? path.relative(workspaceRoot, f.filePath) : f.filePath
  ).join('\n')

  const substituteLane = (template: string): string => {
    const vars: Record<string, string> = {
      columnName: column.name,
      count: String(features.length),
      featurePaths
    }
    return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
  }

  // Level 1: local .kanban/instructions/{columnId}-lane.md
  if (workspaceRoot !== null) {
    const local = resolveLocalTemplate(workspaceRoot, column.id + '-lane')
    if (local) return substituteLane(local)
  }

  // Level 2: bundled prompts/{columnId}-lane.md
  try {
    const bundled = fs.readFileSync(
      path.join(extensionRoot, 'prompts', column.id + '-lane.md'), 'utf8'
    )
    if (bundled.trim()) return substituteLane(bundled)
  } catch {
    // fall through
  }

  // Level 3: generic fallback
  return substituteLane(
    `You are a scrum master reviewing the {{columnName}} lane ({{count}} stories).\nStories to review:\n{{featurePaths}}\nAssess each story's health for this stage and identify issues that need resolution.`
  )
}
```

- [ ] **Step 3: Run the new tests to confirm they pass**

```bash
pnpm test -- tests/extension/ai/promptBuilder.test.ts
```
Expected: all `buildLanePrompt` tests PASS; pre-existing `buildPrompt` tests also PASS

- [ ] **Step 4: Commit**

```bash
git add src/extension/ai/promptBuilder.ts tests/extension/ai/promptBuilder.test.ts
git commit -m "feat: add buildLanePrompt to promptBuilder"
```

---

## Task 4: Write failing tests for `AgentLauncher.launchLane()`

**Files:**
- Modify: `tests/extension/AgentLauncher.test.ts`

- [ ] **Step 1: Update the `promptBuilder` mock to include `buildLanePrompt`**

At the top of `tests/extension/AgentLauncher.test.ts`, find:
```ts
const { mockBuildPrompt } = vi.hoisted(() => ({ mockBuildPrompt: vi.fn(() => 'the-prompt') }))
vi.mock('../../src/extension/ai/promptBuilder', () => ({ buildPrompt: mockBuildPrompt }))
```

Replace with:
```ts
const { mockBuildPrompt, mockBuildLanePrompt } = vi.hoisted(() => ({
  mockBuildPrompt: vi.fn(() => 'the-prompt'),
  mockBuildLanePrompt: vi.fn(() => 'the-lane-prompt')
}))
vi.mock('../../src/extension/ai/promptBuilder', () => ({
  buildPrompt: mockBuildPrompt,
  buildLanePrompt: mockBuildLanePrompt
}))
```

- [ ] **Step 2: Add fixture data and new test suite**

After the `REVIEW_FEATURE` constant and before `beforeEach`, add:
```ts
const BACKLOG_COLUMN: KanbanColumn = { id: 'backlog', name: 'Backlog', color: '#6b7280' }

const BACKLOG_FEATURE: Feature = {
  id: 'feat-backlog', status: 'backlog', priority: 'medium', assignee: null, epic: null,
  dueDate: null, created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z',
  completedAt: null, labels: [], order: 'a1', content: '# Backlog Feature',
  filePath: '/workspace/.kanban/features/feat-backlog.md'
}
```

You also need to add the `KanbanColumn` type import at the top of the file. Change:
```ts
import type { Feature } from '../../src/shared/types'
```
to:
```ts
import type { Feature, KanbanColumn } from '../../src/shared/types'
```

- [ ] **Step 3: Append the new test suite at the end of the file**

```ts
describe('AgentLauncher.launchLane()', () => {
  it('calls buildLanePrompt with the features, column, extensionRoot, and workspaceRoot', () => {
    const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
    launcher.launchLane([BACKLOG_FEATURE], BACKLOG_COLUMN, 'claude', 'default')

    expect(mockBuildLanePrompt).toHaveBeenCalledOnce()
    const [features, column, extensionRoot, workspaceRoot] = mockBuildLanePrompt.mock.calls[0]
    expect(features).toHaveLength(1)
    expect(features[0].id).toBe('feat-backlog')
    expect(column.id).toBe('backlog')
    expect(extensionRoot).toBe('/ext')
    expect(workspaceRoot).toBe('/workspace')
  })

  it('creates a terminal with title "Scrum Master: {column.name}"', () => {
    const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
    launcher.launchLane([BACKLOG_FEATURE], BACKLOG_COLUMN, 'claude', 'default')

    expect(mockCreateTerminal).toHaveBeenCalledOnce()
    const opts = mockCreateTerminal.mock.calls[0][0]
    expect(opts.name).toBe('Scrum Master: Backlog')
    expect(opts.shellPath).toBe('claude')
    expect(opts.shellArgs).toContain('the-lane-prompt')
    expect(opts.cwd).toBe('/workspace')
  })

  it('does NOT launch when workspace is not trusted', () => {
    mockIsTrusted.value = false
    const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
    launcher.launchLane([BACKLOG_FEATURE], BACKLOG_COLUMN, 'claude', 'default')

    expect(mockBuildLanePrompt).not.toHaveBeenCalled()
    expect(mockCreateTerminal).not.toHaveBeenCalled()
    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
  })

  it('does not call buildPrompt from launchLane', () => {
    const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
    launcher.launchLane([BACKLOG_FEATURE], BACKLOG_COLUMN, 'claude', 'default')
    expect(mockBuildPrompt).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run tests to confirm they fail**

```bash
pnpm test -- tests/extension/AgentLauncher.test.ts
```
Expected: FAIL — `launcher.launchLane is not a function`

---

## Task 5: Implement `AgentLauncher.launchLane()`

**Files:**
- Modify: `src/extension/AgentLauncher.ts`

- [ ] **Step 1: Add `buildLanePrompt` to the import**

Change line 5 from:
```ts
import { buildPrompt, type PromptContext } from './ai/promptBuilder'
```
to:
```ts
import { buildPrompt, buildLanePrompt, type PromptContext } from './ai/promptBuilder'
```

- [ ] **Step 2: Add the `launchLane` method to the `AgentLauncher` class**

After the closing brace of the `launch()` method, add:
```ts
  launchLane(
    features: Feature[],
    column: KanbanColumn,
    agent: string,
    permissionMode: string
  ): void {
    if (!vscode.workspace.isTrusted) {
      vscode.window.showWarningMessage(t('panel.aiRequiresTrust'))
      return
    }

    const firstFilePath = features[0]?.filePath
    const workspaceRoot = firstFilePath
      ? (vscode.workspace.getWorkspaceFolder(vscode.Uri.file(firstFilePath))?.uri.fsPath
        ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        ?? null)
      : null

    const prompt = buildLanePrompt(features, column, this._extensionUri.fsPath, workspaceRoot)
    const terminalTitle = `Scrum Master: ${column.name}`

    launchAgentTerminal(
      agent || 'claude',
      permissionMode || 'default',
      prompt,
      workspaceRoot ?? undefined,
      terminalTitle
    )
  }
```

- [ ] **Step 3: Run the tests to confirm they pass**

```bash
pnpm test -- tests/extension/AgentLauncher.test.ts
```
Expected: all `launchLane` tests PASS; pre-existing `launch` tests also PASS

- [ ] **Step 4: Commit**

```bash
git add src/extension/AgentLauncher.ts tests/extension/AgentLauncher.test.ts
git commit -m "feat: add AgentLauncher.launchLane() for lane-level scrum master action"
```

---

## Task 6: Write failing tests for the `laneAction` message handler in KanbanPanel

**Files:**
- Create: `tests/extension/KanbanPanel.laneAction.test.ts`

- [ ] **Step 1: Create the test file**

Create `tests/extension/KanbanPanel.laneAction.test.ts` with the following content:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Feature } from '../../src/shared/types'

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

const BACKLOG_FEATURE_1: Feature = {
  id: 'feat-backlog-1', status: 'backlog', priority: 'medium', assignee: null, epic: null,
  dueDate: null, created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z',
  completedAt: null, labels: [], order: 'a0', content: '# Backlog Feature 1',
  filePath: '/workspace/.kanban/features/feat-backlog-1.md'
}

const BACKLOG_FEATURE_2: Feature = {
  id: 'feat-backlog-2', status: 'backlog', priority: 'high', assignee: null, epic: null,
  dueDate: null, created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z',
  completedAt: null, labels: [], order: 'a1', content: '# Backlog Feature 2',
  filePath: '/workspace/.kanban/features/feat-backlog-2.md'
}

function makeRepo(features: Feature[] = [BACKLOG_FEATURE_1, BACKLOG_FEATURE_2]) {
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
  return { launch: vi.fn(), launchLane: vi.fn() }
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

describe('KanbanPanel laneAction handling', () => {
  it('calls launcher.launchLane with only the resolved features matching featureIds', async () => {
    mockGetConfiguration.mockReturnValue(makeConfigMock())
    mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: '/workspace' } })

    const repo = makeRepo()
    const launcher = makeLauncher()
    KanbanPanel.createOrShow(
      { fsPath: '/ext' } as import('vscode').Uri,
      makeContext(), repo as never, launcher as never
    )

    const handler = captureMessageHandler.get()!
    // Only send feat-backlog-1 (not feat-backlog-2, simulating active filter)
    await handler({ type: 'laneAction', columnId: 'backlog', featureIds: ['feat-backlog-1'] })

    expect(launcher.launchLane).toHaveBeenCalledOnce()
    const [features, column, agent, permissionMode] = launcher.launchLane.mock.calls[0]
    expect(features).toHaveLength(1)
    expect(features[0].id).toBe('feat-backlog-1')
    expect(column.id).toBe('backlog')
    expect(agent).toBe('claude')
    expect(permissionMode).toBe('default')
  })

  it('reads agent from kanban-markdown.aiAgent config', async () => {
    mockGetConfiguration.mockReturnValue(makeConfigMock('codex'))
    mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: '/workspace' } })

    const repo = makeRepo()
    const launcher = makeLauncher()
    KanbanPanel.createOrShow(
      { fsPath: '/ext' } as import('vscode').Uri,
      makeContext(), repo as never, launcher as never
    )

    const handler = captureMessageHandler.get()!
    await handler({ type: 'laneAction', columnId: 'backlog', featureIds: ['feat-backlog-1'] })

    const [, , agent] = launcher.launchLane.mock.calls[0]
    expect(agent).toBe('codex')
  })

  it('does NOT call launchLane when workspace is not trusted', async () => {
    mockIsTrusted.value = false
    mockGetConfiguration.mockReturnValue(makeConfigMock())

    const repo = makeRepo()
    const launcher = makeLauncher()
    KanbanPanel.createOrShow(
      { fsPath: '/ext' } as import('vscode').Uri,
      makeContext(), repo as never, launcher as never
    )

    const handler = captureMessageHandler.get()!
    await handler({ type: 'laneAction', columnId: 'backlog', featureIds: ['feat-backlog-1'] })

    expect(launcher.launchLane).not.toHaveBeenCalled()
    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
  })

  it('does NOT call launchLane when all featureIds resolve to unknown features', async () => {
    mockGetConfiguration.mockReturnValue(makeConfigMock())

    const repo = makeRepo()
    const launcher = makeLauncher()
    KanbanPanel.createOrShow(
      { fsPath: '/ext' } as import('vscode').Uri,
      makeContext(), repo as never, launcher as never
    )

    const handler = captureMessageHandler.get()!
    await handler({ type: 'laneAction', columnId: 'backlog', featureIds: ['nonexistent-id'] })

    expect(launcher.launchLane).not.toHaveBeenCalled()
  })

  it('falls back to DEFAULT_COLUMNS column when columnId not in config', async () => {
    mockGetConfiguration.mockReturnValue({
      get: vi.fn((key: string, def?: unknown) => {
        if (key === 'aiAgent') return 'claude'
        if (key === 'columns') return [] // empty — force fallback
        return def
      })
    })
    mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: '/workspace' } })

    const repo = makeRepo()
    const launcher = makeLauncher()
    KanbanPanel.createOrShow(
      { fsPath: '/ext' } as import('vscode').Uri,
      makeContext(), repo as never, launcher as never
    )

    const handler = captureMessageHandler.get()!
    await handler({ type: 'laneAction', columnId: 'backlog', featureIds: ['feat-backlog-1'] })

    expect(launcher.launchLane).toHaveBeenCalledOnce()
    const [, column] = launcher.launchLane.mock.calls[0]
    // column.id must be 'backlog' even when config has no columns
    expect(column.id).toBe('backlog')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test -- tests/extension/KanbanPanel.laneAction.test.ts
```
Expected: FAIL — `launcher.launchLane is not a function` on the mock, or `laneAction` case is not handled

---

## Task 7: Implement the `laneAction` handler in `KanbanPanel`

**Files:**
- Modify: `src/extension/KanbanPanel.ts`

- [ ] **Step 1: Add `DEFAULT_COLUMNS` to the import in `KanbanPanel.ts`**

Find line 4 in `src/extension/KanbanPanel.ts`:
```ts
import { getTitleFromContent, generateFeatureFilename } from '../shared/types'
```
Change to:
```ts
import { getTitleFromContent, generateFeatureFilename, DEFAULT_COLUMNS } from '../shared/types'
```

- [ ] **Step 2: Add the `laneAction` case to the message handler**

In `src/extension/KanbanPanel.ts`, find the `case 'startWithAI':` block (around line 198). After its closing `break` and before the closing `}` of the `switch`, insert:

```ts
          case 'laneAction': {
            if (!vscode.workspace.isTrusted) {
              vscode.window.showWarningMessage(t('panel.aiRequiresTrust'))
              return
            }
            const laneFeatures = (message.featureIds as string[])
              .map((id: string) => this._repo.features.find(f => f.id === id))
              .filter((f): f is Feature => f !== undefined)
            if (laneFeatures.length === 0) return
            const laneConfig = vscode.workspace.getConfiguration('kanban-markdown')
            const laneColumns = laneConfig.get<KanbanColumn[]>('columns', DEFAULT_COLUMNS)
            const laneColumn = laneColumns.find(c => c.id === message.columnId)
              ?? DEFAULT_COLUMNS.find(c => c.id === message.columnId)
              ?? { id: message.columnId, name: message.columnId, color: '' }
            const laneAgent = laneConfig.get<string>('aiAgent') || 'claude'
            this._launcher.launchLane(laneFeatures, laneColumn, laneAgent, 'default')
            break
          }
```

Note: `Feature` and `KanbanColumn` are already imported at the top of the file. `DEFAULT_COLUMNS` was added in Step 1.

The panel currently holds `private _launcher: AgentLauncher` — since `AgentLauncher` is the concrete class with `launchLane`, no interface change is needed.

- [ ] **Step 3: Run the tests to confirm they pass**

```bash
pnpm test -- tests/extension/KanbanPanel.laneAction.test.ts
```
Expected: all tests PASS

- [ ] **Step 4: Run the full test suite to confirm no regressions**

```bash
pnpm test
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/extension/KanbanPanel.ts tests/extension/KanbanPanel.laneAction.test.ts
git commit -m "feat: handle laneAction message in KanbanPanel"
```

---

## Task 8: Add i18n keys for the Scrum Master menu label

**Files:**
- Modify: `l10n/bundle.l10n.en.json`
- Modify: `l10n/bundle.l10n.es.json`
- Modify: `l10n/bundle.l10n.pt.json`

- [ ] **Step 1: Add English key**

In `l10n/bundle.l10n.en.json`, find `"column.archiveAllCards": "Archive all cards in this list"` and add the new key after it:
```json
"column.scrumMaster": "Scrum Master"
```

- [ ] **Step 2: Add Spanish key**

In `l10n/bundle.l10n.es.json`, find `"column.archiveAllCards"` and add after it:
```json
"column.scrumMaster": "Scrum Master"
```

- [ ] **Step 3: Add Portuguese key**

In `l10n/bundle.l10n.pt.json`, find `"column.archiveAllCards"` and add after it:
```json
"column.scrumMaster": "Scrum Master"
```

- [ ] **Step 4: Verify i18n consistency**

```bash
pnpm check-l10n
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add l10n/bundle.l10n.en.json l10n/bundle.l10n.es.json l10n/bundle.l10n.pt.json
git commit -m "i18n: add column.scrumMaster translation key"
```

---

## Task 9: Add the Scrum Master menu item to `KanbanColumn`

**Files:**
- Modify: `src/webview/components/KanbanColumn.tsx`

- [ ] **Step 1: Add `onLaneAction` to the props interface**

In `src/webview/components/KanbanColumn.tsx`, find the `KanbanColumnProps` interface (line 9). Add the new optional prop after `onArchiveAllCards`:
```ts
  onLaneAction?: () => void
```

- [ ] **Step 2: Destructure the new prop**

In the `KanbanColumn` function signature destructure (line 28), add `onLaneAction` after `onArchiveAllCards`:
```ts
  onArchiveAllCards,
  onLaneAction,
  onDragStart,
```

- [ ] **Step 3: Add the menu item with a divider**

In the dropdown menu JSX (after the `{onArchiveAllCards && (...)}` block, before the closing `</div>` of the menu), add:
```tsx
                {onLaneAction && (
                  <>
                    <hr className="my-1 border-zinc-200 dark:border-zinc-700" />
                    <button
                      className={`w-full text-left px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 ${features.length === 0 ? 'opacity-40 pointer-events-none' : ''}`}
                      onClick={() => { onLaneAction(); setMenuOpen(false) }}
                    >
                      {t('column.scrumMaster')}
                    </button>
                  </>
                )}
```

The full menu block currently ends at line 141 (`</div>`). Place the new JSX between the `{onArchiveAllCards && (...)}` closing brace and the outermost closing `</div>` of the menu div.

- [ ] **Step 4: Run typecheck to confirm the prop types are correct**

```bash
pnpm typecheck
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/KanbanColumn.tsx
git commit -m "feat: add Scrum Master menu item to KanbanColumn"
```

---

## Task 10: Wire up `handleLaneAction` in `KanbanBoard`

**Files:**
- Modify: `src/webview/components/KanbanBoard.tsx`

- [ ] **Step 1: Read the `showBuildWithAI` flag from the store**

In `src/webview/components/KanbanBoard.tsx`, after the existing `useStore` calls (around line 33), add:
```ts
  const showBuildWithAI = useStore((s) => s.cardSettings.showBuildWithAI)
```

- [ ] **Step 2: Add the `handleLaneAction` handler**

After the `handleArchiveAllCards` callback (around line 168), add:
```ts
  const handleLaneAction = useCallback((columnId: string) => {
    const featureIds = filteredByColumn.get(columnId)?.map(f => f.id) ?? []
    vscode.postMessage({ type: 'laneAction', columnId, featureIds })
  }, [filteredByColumn])
```

- [ ] **Step 3: Pass `onLaneAction` to each `KanbanColumn`**

In the JSX where `<KanbanColumn>` is rendered (around line 187), add the new prop after `onArchiveAllCards`:
```tsx
              onLaneAction={showBuildWithAI ? () => handleLaneAction(column.id) : undefined}
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```
Expected: no errors

- [ ] **Step 5: Run the full test suite**

```bash
pnpm test
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/webview/components/KanbanBoard.tsx
git commit -m "feat: wire laneAction handler in KanbanBoard"
```

---

## Task 11: Create bundled lane prompt files

**Files:**
- Create: `prompts/backlog-lane.md`
- Create: `prompts/todo-lane.md`
- Create: `prompts/in-progress-lane.md`
- Create: `prompts/review-lane.md`
- Create: `prompts/done-lane.md`

- [ ] **Step 1: Create `prompts/backlog-lane.md`**

```markdown
You are a scrum master reviewing the {{columnName}} lane ({{count}} stories).

Feature files:
{{featurePaths}}

For each story, read the feature file and surface:
- Vague or untestable acceptance criteria
- Missing `blockedBy` entries for known dependencies
- Duplicate stories covering the same scope
- Stories lacking enough context to plan

Reference `.kanban/instructions.md` for board conventions.
```

- [ ] **Step 2: Create `prompts/todo-lane.md`**

```markdown
You are a scrum master reviewing the {{columnName}} lane ({{count}} stories).

Feature files:
{{featurePaths}}

For each story, read the feature file and check readiness for planning:
- Unresolved blockers in `blockedBy`
- Ambiguous scope or missing decisions
- Dependencies on stories still in backlog
- No implementation plan yet written

Reference `.kanban/instructions.md` for board conventions.
```

- [ ] **Step 3: Create `prompts/in-progress-lane.md`**

```markdown
You are a scrum master reviewing the {{columnName}} lane ({{count}} stories).

Feature files:
{{featurePaths}}

For each story, read the feature file and surface:
- Scope drift from original acceptance criteria
- Missing or stale `worktree` context
- Newly introduced blockers not yet captured in `blockedBy`
- Stories that appear stalled or at risk

Reference `.kanban/instructions.md` for board conventions.
```

- [ ] **Step 4: Create `prompts/review-lane.md`**

```markdown
You are a scrum master reviewing the {{columnName}} lane ({{count}} stories).

Feature files:
{{featurePaths}}

For each story, read the feature file and surface:
- Missing evidence that acceptance criteria were met
- Unresolved code review comments
- Failing checks or missing test coverage notes
- Go/no-go decisions that need to be made before merging

Reference `.kanban/instructions.md` for board conventions.
```

- [ ] **Step 5: Create `prompts/done-lane.md`**

```markdown
You are a scrum master reviewing the {{columnName}} lane ({{count}} stories).

Feature files:
{{featurePaths}}

For each story, read the feature file and confirm:
- `completedAt` is set in the frontmatter
- The story file is in `.kanban/features/done/` (or confirm it was archived)
- Any follow-up stories or retrospective notes have been captured
- No loose ends remain in `blockedBy` that dependent stories are waiting on

Reference `.kanban/instructions.md` for board conventions.
```

- [ ] **Step 6: Run the full test suite one final time**

```bash
pnpm test
```
Expected: all tests PASS

- [ ] **Step 7: Run typecheck**

```bash
pnpm typecheck
```
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add prompts/backlog-lane.md prompts/todo-lane.md prompts/in-progress-lane.md prompts/review-lane.md prompts/done-lane.md
git commit -m "feat: add bundled lane prompt files for scrum master action"
```

---

## Done

All tasks complete. The Scrum Master menu item now appears in every lane's three-dots header menu. Clicking it opens an agent terminal with a lane-specific scrum master prompt operating on the currently-visible (filtered) stories. Custom workspace overrides are supported at `.kanban/instructions/{columnId}-lane.md`.
