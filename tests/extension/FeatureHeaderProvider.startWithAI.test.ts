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
  const mockRepo = {
    getFeaturesDir: vi.fn(() => '/workspace/.kanban/features'),
    getEffectiveRoot: vi.fn(() => '/workspace')
  }
  const provider = new FeatureHeaderProvider(extensionUri, launcher as never, mockRepo as never)
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
    const { launcher, provider } = setupProvider()
    ;(provider as unknown as { _currentDocument: undefined })._currentDocument = undefined
    await capturedMessageHandler!({ type: 'startWithAI', agent: 'claude', permissionMode: 'default' })
    expect(launcher.launch).not.toHaveBeenCalled()
  })
})
