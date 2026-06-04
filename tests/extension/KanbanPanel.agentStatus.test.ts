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
