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
