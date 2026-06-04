# Terminal + Inline Webview Output — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an agent terminal is launched from the kanban board, the corresponding card(s) show a green left-accent bar with an "Agent running" pulsing label; the indicator disappears immediately when the terminal closes.

**Architecture:** `AgentLauncher` gains a `Map<Terminal, string[]>` to track which feature IDs belong to each active terminal, plus a `vscode.EventEmitter` that fires on open/close. `KanbanPanel` subscribes to that emitter and forwards `{ type: 'agentStatus' }` messages to the webview. The webview store keeps `activeAgentFeatureIds: Set<string>`; `FeatureCard` reads it and renders the Option-C indicator (left green bar + tint + pulsing label) when its feature ID is in the set.

**Tech Stack:** TypeScript, VS Code extension API (`vscode.EventEmitter`, `vscode.window.onDidCloseTerminal`), React + Zustand, Tailwind CSS (`animate-pulse`), Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-03-terminal-inline-webview-output-design.md`

---

### Task 1: `launchAgentTerminal` returns `vscode.Terminal`

**Files:**
- Modify: `src/extension/ai/agentLauncher.ts`
- Modify: `tests/extension/ai/agentLauncher.test.ts`

- [ ] **Step 1: Write the failing test**

  Add this test to the existing `agentLauncher.test.ts` file, inside any `describe` block:

  ```typescript
  it('returns the created terminal', () => {
    const terminal = launchAgentTerminal('claude', 'default', 'fix the bug', '/cwd')
    expect(terminal).toBe(mockCreateTerminal.mock.results[0].value)
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  pnpm test --reporter=verbose tests/extension/ai/agentLauncher.test.ts
  ```

  Expected: FAIL — TypeScript error or test failure because `launchAgentTerminal` currently returns `void` (undefined).

- [ ] **Step 3: Change the return type and add `return terminal`**

  In `src/extension/ai/agentLauncher.ts`, make two changes:

  Change the function signature line from:
  ```typescript
  ): void {
  ```
  to:
  ```typescript
  ): vscode.Terminal {
  ```

  Change the last two lines of the function from:
  ```typescript
    terminal.show()
  }
  ```
  to:
  ```typescript
    terminal.show()
    return terminal
  }
  ```

- [ ] **Step 4: Run tests to verify they all pass**

  ```bash
  pnpm test --reporter=verbose tests/extension/ai/agentLauncher.test.ts
  ```

  Expected: All tests PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/extension/ai/agentLauncher.ts tests/extension/ai/agentLauncher.test.ts
  git commit -m "feat: launchAgentTerminal returns the created vscode.Terminal"
  ```

---

### Task 2: `AgentLauncher` tracks active terminals

**Files:**
- Modify: `src/extension/AgentLauncher.ts`
- Modify: `tests/extension/AgentLauncher.test.ts`

- [ ] **Step 1: Update the vscode mock in `AgentLauncher.test.ts`**

  The current mock does not include `vscode.window.onDidCloseTerminal` or `vscode.EventEmitter`, both needed by the updated `AgentLauncher` constructor.

  Replace the `vi.hoisted` block and the `vi.mock('vscode', ...)` call with the following:

  ```typescript
  const {
    mockCreateTerminal, mockShowWarningMessage, mockShow, mockIsTrusted,
    mockGetWorkspaceFolder, captureTerminalClose
  } = vi.hoisted(() => {
    const mockShow = vi.fn()
    const mockCreateTerminal = vi.fn(() => ({ show: mockShow }))
    const mockShowWarningMessage = vi.fn()
    const mockIsTrusted = { value: true }
    const mockGetWorkspaceFolder = vi.fn(() => ({ uri: { fsPath: '/workspace' } }))
    const captureTerminalClose = {
      fn: undefined as ((t: vscode.Terminal) => void) | undefined
    }
    return {
      mockCreateTerminal, mockShowWarningMessage, mockShow, mockIsTrusted,
      mockGetWorkspaceFolder, captureTerminalClose
    }
  })

  vi.mock('vscode', () => ({
    window: {
      createTerminal: mockCreateTerminal,
      showWarningMessage: mockShowWarningMessage,
      onDidCloseTerminal: vi.fn((cb: (t: unknown) => void) => {
        captureTerminalClose.fn = cb as (t: vscode.Terminal) => void
        return { dispose: vi.fn() }
      })
    },
    workspace: {
      get isTrusted() { return mockIsTrusted.value },
      workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
      getWorkspaceFolder: mockGetWorkspaceFolder,
      getConfiguration: vi.fn(() => ({
        get: (key: string, def: unknown) => key === 'columns' ? [
          { id: 'backlog', name: 'Backlog', color: '#6b7280' },
          { id: 'review', name: 'Review', color: '#8b5cf6' }
        ] : def
      }))
    },
    Uri: { file: (p: string) => ({ fsPath: p }) },
    Disposable: { from: (...d: { dispose: () => void }[]) => ({ dispose: () => d.forEach(x => x.dispose()) }) },
    EventEmitter: class EventEmitterMock<T> {
      private _listeners: ((e: T) => void)[] = []
      event = (cb: (e: T) => void) => { this._listeners.push(cb); return { dispose: vi.fn() } }
      fire(e: T) { [...this._listeners].forEach(l => l(e)) }
      dispose() { this._listeners = [] }
    }
  }))
  ```

  Note: the `import type { Feature, KanbanColumn } from '../../src/shared/types'` line at the top of the file needs `vscode` to be available as a type for `captureTerminalClose`. Add this import if not already present:

  ```typescript
  import type * as vscode from 'vscode'
  ```

- [ ] **Step 2: Write the failing tests**

  Add this `describe` block to `tests/extension/AgentLauncher.test.ts`, after the existing describe block. The `REVIEW_FEATURE` constant and `KanbanColumn` type are already defined in the file:

  ```typescript
  describe('agent status tracking', () => {
    let launcher: AgentLauncher
    let statusListener: ReturnType<typeof vi.fn>

    beforeEach(() => {
      vi.clearAllMocks()
      mockIsTrusted.value = true
      launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
      statusListener = vi.fn()
      launcher.onAgentStatusChanged(statusListener)
    })

    it('fires active:true with the feature id when launch() creates a terminal', () => {
      launcher.launch(REVIEW_FEATURE, 'claude', 'default')
      expect(statusListener).toHaveBeenCalledOnce()
      expect(statusListener.mock.calls[0][0]).toEqual({
        featureIds: ['my-feat'],
        active: true
      })
    })

    it('fires active:true with all feature ids when launchLane() runs', () => {
      const f2 = { ...REVIEW_FEATURE, id: 'feat-2' }
      const column: KanbanColumn = { id: 'review', name: 'Review', color: '#8b5cf6' }
      launcher.launchLane([REVIEW_FEATURE, f2], column, 'claude', 'default')
      expect(statusListener).toHaveBeenCalledOnce()
      expect(statusListener.mock.calls[0][0]).toEqual({
        featureIds: ['my-feat', 'feat-2'],
        active: true
      })
    })

    it('fires active:false with the feature id when the terminal closes', () => {
      launcher.launch(REVIEW_FEATURE, 'claude', 'default')
      const terminal = mockCreateTerminal.mock.results[0].value
      captureTerminalClose.fn!(terminal)
      expect(statusListener).toHaveBeenCalledTimes(2)
      expect(statusListener.mock.calls[1][0]).toEqual({
        featureIds: ['my-feat'],
        active: false
      })
    })

    it('activeFeatureIds returns deduplicated ids across all active terminals', () => {
      const f2 = { ...REVIEW_FEATURE, id: 'feat-2' }
      const column: KanbanColumn = { id: 'review', name: 'Review', color: '#8b5cf6' }
      launcher.launch(REVIEW_FEATURE, 'claude', 'default')
      launcher.launchLane([f2], column, 'claude', 'default')
      const ids = launcher.activeFeatureIds
      expect(ids).toContain('my-feat')
      expect(ids).toContain('feat-2')
      expect(ids).toHaveLength(2)
    })

    it('closing an untracked terminal does not fire the event', () => {
      const untracked = { show: vi.fn() }
      captureTerminalClose.fn!(untracked as unknown as vscode.Terminal)
      expect(statusListener).not.toHaveBeenCalled()
    })

    it('does not fire active:true when workspace is not trusted', () => {
      mockIsTrusted.value = false
      launcher.launch(REVIEW_FEATURE, 'claude', 'default')
      expect(statusListener).not.toHaveBeenCalled()
    })
  })
  ```

- [ ] **Step 3: Run tests to verify they fail**

  ```bash
  pnpm test --reporter=verbose tests/extension/AgentLauncher.test.ts
  ```

  Expected: The new tests in `'agent status tracking'` FAIL because `AgentLauncher` has no `onAgentStatusChanged`, no `activeFeatureIds`, and its constructor does not subscribe to `onDidCloseTerminal`.

- [ ] **Step 4: Implement tracking in `AgentLauncher.ts`**

  Replace the entire content of `src/extension/AgentLauncher.ts` with:

  ```typescript
  import * as path from 'path'
  import * as vscode from 'vscode'
  import type { Feature, KanbanColumn } from '../shared/types'
  import { getTitleFromContent, DEFAULT_COLUMNS } from '../shared/types'
  import { buildPrompt, buildLanePrompt, type PromptContext } from './ai/promptBuilder'
  import { launchAgentTerminal } from './ai/agentLauncher'
  import { t } from './l10n'

  export class AgentLauncher {
    private readonly _activeTerminals = new Map<vscode.Terminal, string[]>()
    private readonly _onAgentStatusChanged = new vscode.EventEmitter<{ featureIds: string[]; active: boolean }>()
    readonly onAgentStatusChanged = this._onAgentStatusChanged.event
    private readonly _terminalSub: vscode.Disposable

    constructor(private readonly _extensionUri: vscode.Uri) {
      this._terminalSub = vscode.window.onDidCloseTerminal(terminal => {
        const featureIds = this._activeTerminals.get(terminal)
        if (!featureIds) return
        this._activeTerminals.delete(terminal)
        this._onAgentStatusChanged.fire({ featureIds, active: false })
      })
    }

    get activeFeatureIds(): string[] {
      const ids = new Set<string>()
      for (const featureIds of this._activeTerminals.values()) {
        for (const id of featureIds) ids.add(id)
      }
      return Array.from(ids)
    }

    dispose(): void {
      this._terminalSub.dispose()
      this._onAgentStatusChanged.dispose()
    }

    launch(feature: Feature, agent: string, permissionMode: string, effectiveRoot?: string | null): void {
      if (!vscode.workspace.isTrusted) {
        vscode.window.showWarningMessage(t('panel.aiRequiresTrust'))
        return
      }

      const workspaceRoot =
        effectiveRoot
        ?? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(feature.filePath))?.uri.fsPath
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

      const prompt = buildPrompt(ctx, column, this._extensionUri.fsPath, workspaceRoot)
      const terminalTitle = `${column.name}: ${ctx.title}`

      const terminal = launchAgentTerminal(
        agent || 'claude',
        permissionMode || 'default',
        prompt,
        workspaceRoot ?? undefined,
        terminalTitle
      )
      this._activeTerminals.set(terminal, [feature.id])
      this._onAgentStatusChanged.fire({ featureIds: [feature.id], active: true })
    }

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
      const workspaceFolder = firstFilePath
        ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(firstFilePath))?.uri.fsPath ?? null
        : null
      const workspaceRoot = workspaceFolder
      const cwd = workspaceFolder
        ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        ?? (firstFilePath ? path.dirname(firstFilePath) : undefined)

      const prompt = buildLanePrompt(features, column, this._extensionUri.fsPath, workspaceRoot)
      const terminalTitle = `Scrum Master: ${column.name}`

      const terminal = launchAgentTerminal(
        agent || 'claude',
        permissionMode || 'default',
        prompt,
        cwd,
        terminalTitle
      )
      const featureIds = features.map(f => f.id)
      this._activeTerminals.set(terminal, featureIds)
      this._onAgentStatusChanged.fire({ featureIds, active: true })
    }
  }
  ```

- [ ] **Step 5: Run all tests to verify they pass**

  ```bash
  pnpm test --reporter=verbose tests/extension/AgentLauncher.test.ts
  ```

  Expected: All tests in both describe blocks PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add src/extension/AgentLauncher.ts src/extension/ai/agentLauncher.ts tests/extension/AgentLauncher.test.ts
  git commit -m "feat: AgentLauncher tracks active terminals and fires onAgentStatusChanged"
  ```

---

### Task 3: Add `agentStatus` to `ExtensionMessage`

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add the `agentStatus` union member**

  In `src/shared/types.ts`, change:
  ```typescript
  export type ExtensionMessage =
    | { type: 'init'; features: Feature[]; columns: KanbanColumn[]; settings: CardDisplaySettings; collapsedColumns: string[]; boardViewMode: BoardViewMode; collapsedEpics: string[]; locale: string; translations: Record<string, string>; activeFolderName?: string }
    | { type: 'featuresUpdated'; features: Feature[] }
    | { type: 'featurePatch'; add?: Feature[]; update?: Feature[]; remove?: string[] }
    | { type: 'triggerCreateDialog' }
    | { type: 'featureContent'; featureId: string; content: string; frontmatter: FeatureFrontmatter }
  ```
  to:
  ```typescript
  export type ExtensionMessage =
    | { type: 'init'; features: Feature[]; columns: KanbanColumn[]; settings: CardDisplaySettings; collapsedColumns: string[]; boardViewMode: BoardViewMode; collapsedEpics: string[]; locale: string; translations: Record<string, string>; activeFolderName?: string }
    | { type: 'featuresUpdated'; features: Feature[] }
    | { type: 'featurePatch'; add?: Feature[]; update?: Feature[]; remove?: string[] }
    | { type: 'triggerCreateDialog' }
    | { type: 'featureContent'; featureId: string; content: string; frontmatter: FeatureFrontmatter }
    | { type: 'agentStatus'; featureIds: string[]; active: boolean }
  ```

- [ ] **Step 2: Run full test suite to verify no regressions**

  ```bash
  pnpm test
  ```

  Expected: All tests PASS (this is a type-only change; no runtime behavior changes).

- [ ] **Step 3: Commit**

  ```bash
  git add src/shared/types.ts
  git commit -m "feat: add agentStatus to ExtensionMessage type"
  ```

---

### Task 4: `KanbanPanel` forwards `agentStatus` to the webview

**Files:**
- Modify: `tests/extension/KanbanPanel.laneAction.test.ts`
- Modify: `tests/extension/KanbanPanel.startWithAI.test.ts`
- Create: `tests/extension/KanbanPanel.agentStatus.test.ts`
- Modify: `src/extension/KanbanPanel.ts`

- [ ] **Step 1: Update `makeLauncher()` in `KanbanPanel.laneAction.test.ts`**

  Find and replace:
  ```typescript
  function makeLauncher() {
    return { launch: vi.fn(), launchLane: vi.fn() }
  }
  ```
  with:
  ```typescript
  function makeLauncher() {
    return {
      launch: vi.fn(),
      launchLane: vi.fn(),
      onAgentStatusChanged: vi.fn(() => ({ dispose: vi.fn() })),
      activeFeatureIds: [] as string[]
    }
  }
  ```

- [ ] **Step 2: Update `makeLauncher()` in `KanbanPanel.startWithAI.test.ts`**

  Find and replace:
  ```typescript
  function makeLauncher() {
    return { launch: vi.fn() }
  }
  ```
  with:
  ```typescript
  function makeLauncher() {
    return {
      launch: vi.fn(),
      onAgentStatusChanged: vi.fn(() => ({ dispose: vi.fn() })),
      activeFeatureIds: [] as string[]
    }
  }
  ```

- [ ] **Step 3: Run existing KanbanPanel tests to verify they still pass**

  ```bash
  pnpm test --reporter=verbose tests/extension/KanbanPanel.laneAction.test.ts tests/extension/KanbanPanel.startWithAI.test.ts
  ```

  Expected: All existing tests PASS (mock is updated but `KanbanPanel` doesn't yet call these methods).

- [ ] **Step 4: Create the failing agentStatus test file**

  Create `tests/extension/KanbanPanel.agentStatus.test.ts` with this content:

  ```typescript
  import { describe, it, expect, vi, beforeEach } from 'vitest'
  import type { Feature } from '../../src/shared/types'

  const {
    mockCreateTerminal, mockPostMessage, mockGetConfiguration,
    mockGetWorkspaceFolder, mockShowWarningMessage, mockIsTrusted,
    captureMessageHandler
  } = vi.hoisted(() => {
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
    return {
      mockCreateTerminal, mockPostMessage, mockGetConfiguration,
      mockGetWorkspaceFolder, mockShowWarningMessage, mockIsTrusted,
      captureMessageHandler
    }
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
    EventEmitter: class EventEmitterMock<T> {
      private _ls: ((e: T) => void)[] = []
      event = (cb: (e: T) => void) => { this._ls.push(cb); return { dispose: vi.fn() } }
      fire(e: T) { [...this._ls].forEach(l => l(e)) }
      dispose() {}
    }
  }))

  vi.mock('fs')

  import { KanbanPanel } from '../../src/extension/KanbanPanel'

  const FEATURE: Feature = {
    id: 'feat-1', status: 'todo', priority: 'medium', assignee: null, epic: null,
    dueDate: null, created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z',
    completedAt: null, labels: [], order: 'a0', content: '# Feature 1',
    filePath: '/workspace/.kanban/features/feat-1.md'
  }

  function makeRepo(features: Feature[] = [FEATURE]) {
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
      getEffectiveRoot: vi.fn(() => '/workspace'),
      dispose: vi.fn()
    }
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

  function makeConfigMock() {
    return {
      get: vi.fn((key: string, def?: unknown) => {
        if (key === 'columns') return [
          { id: 'todo', name: 'To Do', color: '#3b82f6' }
        ]
        return def
      })
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsTrusted.value = true
    KanbanPanel.currentPanel = undefined
    mockGetConfiguration.mockReturnValue(makeConfigMock())
    mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: '/workspace' } })
  })

  describe('KanbanPanel agentStatus forwarding', () => {
    it('subscribes to launcher.onAgentStatusChanged in the constructor', () => {
      const launcher = {
        launch: vi.fn(),
        launchLane: vi.fn(),
        activeFeatureIds: [] as string[],
        onAgentStatusChanged: vi.fn(() => ({ dispose: vi.fn() }))
      }
      KanbanPanel.createOrShow(
        { fsPath: '/ext' } as import('vscode').Uri,
        makeContext(), makeRepo() as never, launcher as never
      )
      expect(launcher.onAgentStatusChanged).toHaveBeenCalled()
    })

    it('posts agentStatus to webview when onAgentStatusChanged fires', () => {
      let agentStatusCb: ((e: { featureIds: string[]; active: boolean }) => void) | undefined
      const launcher = {
        launch: vi.fn(),
        launchLane: vi.fn(),
        activeFeatureIds: [] as string[],
        onAgentStatusChanged: vi.fn((cb: (e: { featureIds: string[]; active: boolean }) => void) => {
          agentStatusCb = cb
          return { dispose: vi.fn() }
        })
      }
      KanbanPanel.createOrShow(
        { fsPath: '/ext' } as import('vscode').Uri,
        makeContext(), makeRepo() as never, launcher as never
      )

      agentStatusCb!({ featureIds: ['feat-1'], active: true })

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'agentStatus',
        featureIds: ['feat-1'],
        active: true
      })
    })

    it('sends agentStatus with active:true on ready when activeFeatureIds is non-empty', async () => {
      const launcher = {
        launch: vi.fn(),
        launchLane: vi.fn(),
        activeFeatureIds: ['feat-1', 'feat-2'],
        onAgentStatusChanged: vi.fn(() => ({ dispose: vi.fn() }))
      }
      KanbanPanel.createOrShow(
        { fsPath: '/ext' } as import('vscode').Uri,
        makeContext(), makeRepo() as never, launcher as never
      )

      const handler = captureMessageHandler.get()!
      await handler({ type: 'ready' })

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'agentStatus',
        featureIds: ['feat-1', 'feat-2'],
        active: true
      })
    })

    it('does NOT send agentStatus on ready when activeFeatureIds is empty', async () => {
      const launcher = {
        launch: vi.fn(),
        launchLane: vi.fn(),
        activeFeatureIds: [] as string[],
        onAgentStatusChanged: vi.fn(() => ({ dispose: vi.fn() }))
      }
      KanbanPanel.createOrShow(
        { fsPath: '/ext' } as import('vscode').Uri,
        makeContext(), makeRepo() as never, launcher as never
      )

      const handler = captureMessageHandler.get()!
      mockPostMessage.mockClear()
      await handler({ type: 'ready' })

      expect(mockPostMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'agentStatus' })
      )
    })
  })
  ```

- [ ] **Step 5: Run new tests to verify they fail**

  ```bash
  pnpm test --reporter=verbose tests/extension/KanbanPanel.agentStatus.test.ts
  ```

  Expected: Tests FAIL because `KanbanPanel` does not yet call `launcher.onAgentStatusChanged` or send `agentStatus` on `ready`.

- [ ] **Step 6: Update `KanbanPanel.ts`**

  In `src/extension/KanbanPanel.ts`, in the private constructor, find the block that starts the repo subscription:
  ```typescript
    // Subscribe to repo changes
    this._repo.onDidChange(newFeatures => {
  ```

  Add the agent status subscription immediately before it:
  ```typescript
    // Subscribe to agent terminal lifecycle events
    this._launcher.onAgentStatusChanged(({ featureIds, active }) => {
      this._panel.webview.postMessage({ type: 'agentStatus', featureIds, active })
    }, null, this._disposables)

    // Subscribe to repo changes
    this._repo.onDidChange(newFeatures => {
  ```

  In the same file, find the `ready` message handler:
  ```typescript
          case 'ready':
            await this._repo.load()
            break
  ```

  Replace it with:
  ```typescript
          case 'ready':
            await this._repo.load()
            if (this._launcher.activeFeatureIds.length > 0) {
              this._panel.webview.postMessage({
                type: 'agentStatus',
                featureIds: this._launcher.activeFeatureIds,
                active: true
              })
            }
            break
  ```

- [ ] **Step 7: Run all KanbanPanel and AgentLauncher tests**

  ```bash
  pnpm test --reporter=verbose tests/extension/KanbanPanel.agentStatus.test.ts tests/extension/KanbanPanel.laneAction.test.ts tests/extension/KanbanPanel.startWithAI.test.ts tests/extension/AgentLauncher.test.ts
  ```

  Expected: All tests PASS.

- [ ] **Step 8: Commit**

  ```bash
  git add src/extension/KanbanPanel.ts tests/extension/KanbanPanel.agentStatus.test.ts tests/extension/KanbanPanel.laneAction.test.ts tests/extension/KanbanPanel.startWithAI.test.ts
  git commit -m "feat: KanbanPanel subscribes to AgentLauncher and forwards agentStatus to webview"
  ```

---

### Task 5: Webview store tracks `activeAgentFeatureIds`

**Files:**
- Modify: `src/webview/store/index.ts`
- Modify: `tests/webview/store.test.ts`

- [ ] **Step 1: Write the failing tests**

  Add this describe block to `tests/webview/store.test.ts`:

  ```typescript
  describe('updateAgentStatus', () => {
    it('adds feature ids to activeAgentFeatureIds when active is true', () => {
      useStore.getState().updateAgentStatus(['feat-1', 'feat-2'], true)
      const { activeAgentFeatureIds } = useStore.getState()
      expect(activeAgentFeatureIds.has('feat-1')).toBe(true)
      expect(activeAgentFeatureIds.has('feat-2')).toBe(true)
    })

    it('removes feature ids from activeAgentFeatureIds when active is false', () => {
      useStore.setState({ activeAgentFeatureIds: new Set(['feat-1', 'feat-2']) })
      useStore.getState().updateAgentStatus(['feat-1'], false)
      const { activeAgentFeatureIds } = useStore.getState()
      expect(activeAgentFeatureIds.has('feat-1')).toBe(false)
      expect(activeAgentFeatureIds.has('feat-2')).toBe(true)
    })

    it('does not mutate the existing set', () => {
      const before = useStore.getState().activeAgentFeatureIds
      useStore.getState().updateAgentStatus(['feat-1'], true)
      const after = useStore.getState().activeAgentFeatureIds
      expect(before).not.toBe(after)
    })

    it('initializes to empty set', () => {
      expect(useStore.getState().activeAgentFeatureIds.size).toBe(0)
    })
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  pnpm test --reporter=verbose tests/webview/store.test.ts
  ```

  Expected: The `updateAgentStatus` tests FAIL because the store has no `activeAgentFeatureIds` or `updateAgentStatus`.

- [ ] **Step 3: Add `activeAgentFeatureIds` and `updateAgentStatus` to the store**

  In `src/webview/store/index.ts`, add to the `KanbanState` interface after `activeFolderName`:
  ```typescript
    activeAgentFeatureIds: Set<string>
    updateAgentStatus: (featureIds: string[], active: boolean) => void
  ```

  In the `create<KanbanState>((set, get) => ({` block, add after `activeFolderName: ''`:
  ```typescript
    activeAgentFeatureIds: new Set<string>(),
  ```

  Add after the `setActiveFolderName` action:
  ```typescript
    updateAgentStatus: (featureIds, active) => set(state => {
      const next = new Set(state.activeAgentFeatureIds)
      for (const id of featureIds) {
        if (active) next.add(id)
        else next.delete(id)
      }
      return { activeAgentFeatureIds: next }
    }),
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  pnpm test --reporter=verbose tests/webview/store.test.ts
  ```

  Expected: All tests PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/webview/store/index.ts tests/webview/store.test.ts
  git commit -m "feat: webview store tracks activeAgentFeatureIds"
  ```

---

### Task 6: App handles `agentStatus` messages

**Files:**
- Modify: `src/webview/App.tsx`
- Modify: `tests/webview/App.test.tsx`

- [ ] **Step 1: Write the failing test**

  Read `tests/webview/App.test.tsx` to find where messages are dispatched — the file uses `window.dispatchEvent(new MessageEvent('message', { data: ... }))`. Add this test after the existing tests:

  ```typescript
  describe('agentStatus message handling', () => {
    it('sets active feature ids in the store when active is true', async () => {
      const { useStore } = await import('../../src/webview/store')
      render(<App />)
      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'init', features: [], columns: COLUMNS, settings: INIT_SETTINGS,
                  collapsedColumns: [], collapsedEpics: [], boardViewMode: 'standard',
                  locale: 'en', translations: {} }
        }))
      })
      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'agentStatus', featureIds: ['feat-42'], active: true }
        }))
      })
      expect(useStore.getState().activeAgentFeatureIds.has('feat-42')).toBe(true)
    })

    it('removes feature ids from the store when active is false', async () => {
      const { useStore } = await import('../../src/webview/store')
      useStore.setState({ activeAgentFeatureIds: new Set(['feat-42']) })
      render(<App />)
      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'init', features: [], columns: COLUMNS, settings: INIT_SETTINGS,
                  collapsedColumns: [], collapsedEpics: [], boardViewMode: 'standard',
                  locale: 'en', translations: {} }
        }))
      })
      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'agentStatus', featureIds: ['feat-42'], active: false }
        }))
      })
      expect(useStore.getState().activeAgentFeatureIds.has('feat-42')).toBe(false)
    })
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  pnpm test --reporter=verbose tests/webview/App.test.tsx
  ```

  Expected: The new tests FAIL because App does not handle `agentStatus`.

- [ ] **Step 3: Update `App.tsx`**

  In `src/webview/App.tsx`, in the `useStore()` destructuring near the top of the `App` function, add `updateAgentStatus`:
  ```typescript
  const {
    columns,
    cardSettings,
    setFeatures,
    setColumns,
    setIsDarkMode,
    setCardSettings,
    setCollapsedColumns,
    setCollapsedEpics,
    boardViewMode,
    setBoardViewMode,
    setLocale,
    setActiveFolderName,
    addFeature,
    updateFeature,
    removeFeature,
    updateAgentStatus
  } = useStore()
  ```

  In the `handleMessage` switch statement, add a new case after `featureContent`:
  ```typescript
        case 'agentStatus':
          updateAgentStatus(message.featureIds, message.active)
          break
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  pnpm test --reporter=verbose tests/webview/App.test.tsx
  ```

  Expected: All tests PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/webview/App.tsx tests/webview/App.test.tsx
  git commit -m "feat: App handles agentStatus messages from the extension"
  ```

---

### Task 7: `FeatureCard` renders the agent indicator

**Files:**
- Modify: `src/webview/components/FeatureCard.tsx`
- Modify: `tests/webview/components/FeatureCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

  Add these tests to `tests/webview/components/FeatureCard.test.tsx`:

  ```typescript
  describe('agent running indicator', () => {
    it('shows "Agent running" label when feature id is in activeAgentFeatureIds', () => {
      useStore.setState({ activeAgentFeatureIds: new Set(['card-1']) })
      setSettings()
      render(<FeatureCard feature={makeFeature({ id: 'card-1' })} onClick={vi.fn()} />)
      expect(screen.getByText('Agent running')).toBeInTheDocument()
    })

    it('does not show "Agent running" when feature id is not in activeAgentFeatureIds', () => {
      useStore.setState({ activeAgentFeatureIds: new Set(['other-id']) })
      setSettings()
      render(<FeatureCard feature={makeFeature({ id: 'card-1' })} onClick={vi.fn()} />)
      expect(screen.queryByText('Agent running')).not.toBeInTheDocument()
    })

    it('does not show "Agent running" when activeAgentFeatureIds is empty', () => {
      useStore.setState({ activeAgentFeatureIds: new Set() })
      setSettings()
      render(<FeatureCard feature={makeFeature({ id: 'card-1' })} onClick={vi.fn()} />)
      expect(screen.queryByText('Agent running')).not.toBeInTheDocument()
    })
  })
  ```

  The `useStore.setState` calls in these tests set `activeAgentFeatureIds` directly. The `initialState` reset in `beforeEach` will clear it between tests (since the initial store state has an empty set).

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  pnpm test --reporter=verbose tests/webview/components/FeatureCard.test.tsx
  ```

  Expected: The new tests FAIL because `FeatureCard` does not read `activeAgentFeatureIds` or render the indicator.

- [ ] **Step 3: Update `FeatureCard.tsx`**

  In `src/webview/components/FeatureCard.tsx`, change the `useStore()` destructuring:
  ```typescript
  const { cardSettings, locale, isDarkMode } = useStore()
  ```
  to:
  ```typescript
  const { cardSettings, locale, isDarkMode, activeAgentFeatureIds } = useStore()
  ```

  Add this line immediately after:
  ```typescript
  const isAgentActive = activeAgentFeatureIds.has(feature.id)
  ```

  Change the outer `<div` to add conditional inline styles for the left accent and tint:
  ```tsx
  <div
    onClick={onClick}
    className={`group relative flex flex-col bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 ${cardSettings.compactMode ? 'p-2 min-h-[4.5rem]' : 'p-3 min-h-[7rem]'} cursor-pointer hover:shadow-md transition-shadow ${
      isDragging ? 'shadow-lg opacity-90' : ''
    }`}
    style={isAgentActive ? {
      borderLeft: '3px solid var(--vscode-testing-iconPassed)',
      background: 'color-mix(in srgb, var(--vscode-testing-iconPassed) 6%, var(--vscode-editor-background, white))'
    } : undefined}
  >
  ```

  At the bottom of the card, just before the closing `</div>` of the outer wrapper, add the "Agent running" label after the footer `</div>`:
  ```tsx
      {/* Agent running indicator */}
      {isAgentActive && (
        <div className="flex items-center gap-1 mt-1" style={{ color: 'var(--vscode-testing-iconPassed)' }}>
          <span
            className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: 'var(--vscode-testing-iconPassed)' }}
          />
          <span className="text-[10px] font-medium">Agent running</span>
        </div>
      )}
    </div>
  ```

  The full updated return block at the bottom of the card's `return` statement (showing placement context):
  ```tsx
      {/* Footer */}
      <div className="flex items-center justify-between text-xs mt-auto">
        ...existing footer content...
      </div>

      {/* Agent running indicator */}
      {isAgentActive && (
        <div className="flex items-center gap-1 mt-1" style={{ color: 'var(--vscode-testing-iconPassed)' }}>
          <span
            className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: 'var(--vscode-testing-iconPassed)' }}
          />
          <span className="text-[10px] font-medium">Agent running</span>
        </div>
      )}
    </div>
  ```

- [ ] **Step 4: Run all tests to verify they pass**

  ```bash
  pnpm test --reporter=verbose tests/webview/components/FeatureCard.test.tsx
  ```

  Expected: All tests PASS.

- [ ] **Step 5: Run the full test suite**

  ```bash
  pnpm test
  ```

  Expected: All tests PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add src/webview/components/FeatureCard.tsx tests/webview/components/FeatureCard.test.tsx
  git commit -m "feat: FeatureCard shows agent running indicator when terminal is active"
  ```
