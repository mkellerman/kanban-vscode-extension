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
    getEffectiveRoot: vi.fn(() => '/workspace'),
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
  return {
    launch: vi.fn(),
    onAgentStatusChanged: vi.fn(() => ({ dispose: vi.fn() })),
    activeFeatureIds: [] as string[]
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

async function sendStartWithAI(
  agent = 'claude',
  permissionMode = 'default',
  featureId = 'my-review-feature'
) {
  const handler = captureMessageHandler.get()
  if (!handler) throw new Error('message handler not captured')
  await handler({ type: 'openFeature', featureId })
  await handler({ type: 'startWithAI', agent, permissionMode })
}

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

    const handler = captureMessageHandler.get()!
    await handler({ type: 'startWithAI', agent: 'claude', permissionMode: 'default' })

    expect(launcher.launch).not.toHaveBeenCalled()
  })
})
