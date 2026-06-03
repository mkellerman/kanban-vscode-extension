/**
 * Wiring test: asserts that FeatureHeaderProvider's startWithAI case calls
 * buildPrompt with the correct arguments (column, extensionRoot, workspaceRoot,
 * settingsTemplate).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoist shared mocks so they are available inside vi.mock factories
// ---------------------------------------------------------------------------
const { mockShow, mockCreateTerminal, mockPostMessage,
        mockGetConfiguration, mockGetWorkspaceFolder, mockShowWarningMessage,
        mockIsTrusted } = vi.hoisted(() => {
  const mockShow = vi.fn()
  const mockCreateTerminal = vi.fn(() => ({ show: mockShow }))
  const mockPostMessage = vi.fn()
  const mockGetConfiguration = vi.fn()
  const mockGetWorkspaceFolder = vi.fn()
  const mockShowWarningMessage = vi.fn()
  const mockIsTrusted = { value: true }
  return { mockShow, mockCreateTerminal, mockPostMessage,
           mockGetConfiguration, mockGetWorkspaceFolder, mockShowWarningMessage,
           mockIsTrusted }
})

// keep linter quiet on unused vars — they are declared for completeness
void mockShow
void mockPostMessage

// ---------------------------------------------------------------------------
// Track the captured message handler
// ---------------------------------------------------------------------------
let capturedMessageHandler: ((msg: unknown) => Promise<void>) | undefined

// ---------------------------------------------------------------------------
// Mock vscode before any other imports
// ---------------------------------------------------------------------------
vi.mock('vscode', () => ({
  window: {
    registerWebviewViewProvider: vi.fn(),
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
    activeTextEditor: undefined,
    createTerminal: mockCreateTerminal,
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
  ViewColumn: { One: 1, Two: 2, Beside: -2 },
  Disposable: {
    from: (...disposables: unknown[]) => ({ dispose: vi.fn(), disposables })
  }
}))

// ---------------------------------------------------------------------------
// Mock promptBuilder
// ---------------------------------------------------------------------------
const { mockBuildPrompt } = vi.hoisted(() => {
  return { mockBuildPrompt: vi.fn(() => 'mocked prompt') }
})

vi.mock('../../src/extension/ai/promptBuilder', () => ({
  buildPrompt: mockBuildPrompt
}))

// ---------------------------------------------------------------------------
// Mock fs
// ---------------------------------------------------------------------------
vi.mock('fs')

// ---------------------------------------------------------------------------
// Feature file content used as mock document text
// ---------------------------------------------------------------------------
const FEATURE_CONTENT = [
  '---',
  'id: my-feat',
  'status: review',
  'priority: high',
  'assignee: null',
  'epic: null',
  'dueDate: null',
  'created: 2026-01-01T00:00:00.000Z',
  'modified: 2026-01-01T00:00:00.000Z',
  'completedAt: null',
  'labels: [frontend]',
  'order: a0',
  '---',
  '',
  '# My Review Feature',
  '',
  'Feature description here.'
].join('\n')

const FEATURE_PATH = '/workspace/.devtool/features/my-feat.md'
const EXTENSION_ROOT = '/ext'
const WORKSPACE_ROOT = '/workspace'

const DEFAULT_COLUMNS = [
  { id: 'backlog', name: 'Backlog', color: '#6b7280' },
  { id: 'todo', name: 'To Do', color: '#3b82f6' },
  { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
  { id: 'review', name: 'Review', color: '#8b5cf6' },
  { id: 'done', name: 'Done', color: '#22c55e' }
]

const REVIEW_COLUMN = { id: 'review', name: 'Review', color: '#8b5cf6' }

// ---------------------------------------------------------------------------
// Import subject after mocks
// ---------------------------------------------------------------------------
import { FeatureHeaderProvider } from '../../src/extension/FeatureHeaderProvider'

// ---------------------------------------------------------------------------
// Build minimal mock objects
// ---------------------------------------------------------------------------

function makeWebviewView() {
  const view = {
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
  }
  return view as unknown as import('vscode').WebviewView
}

function makeDocument(content = FEATURE_CONTENT, fsPath = FEATURE_PATH) {
  return {
    getText: () => content,
    uri: {
      fsPath,
      toString: () => `file://${fsPath}`
    },
    save: vi.fn(() => Promise.resolve(true)),
    lineCount: content.split('\n').length
  } as unknown as import('vscode').TextDocument
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsTrusted.value = true
  capturedMessageHandler = undefined
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FeatureHeaderProvider startWithAI wiring', () => {
  it('calls buildPrompt with the correct column, extensionRoot, workspaceRoot, and settingsTemplate', async () => {
    const configMock = {
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === 'columns') return DEFAULT_COLUMNS
        if (key === 'featuresDirectory') return '.devtool/features'
        return defaultValue
      })
    }
    mockGetConfiguration.mockReturnValue(configMock)
    mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: WORKSPACE_ROOT } })

    const extensionUri = { fsPath: EXTENSION_ROOT } as import('vscode').Uri
    const provider = new FeatureHeaderProvider(extensionUri)

    const webviewView = makeWebviewView()
    provider.resolveWebviewView(
      webviewView,
      {} as import('vscode').WebviewViewResolveContext,
      { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as import('vscode').CancellationToken
    )

    const providerAny = provider as unknown as { _currentDocument: import('vscode').TextDocument }
    providerAny._currentDocument = makeDocument()

    expect(capturedMessageHandler).toBeDefined()
    await capturedMessageHandler!({ type: 'startWithAI', agent: 'claude', permissionMode: 'default' })

    expect(mockBuildPrompt).toHaveBeenCalledOnce()

    const [ctx, column, extensionRoot, workspaceRoot, settingsTemplate] = mockBuildPrompt.mock.calls[0]

    expect(ctx.title).toBe('My Review Feature')
    expect(ctx.status).toBe('review')
    expect(ctx.priority).toBe('high')
    expect(ctx.labels).toEqual(['frontend'])
    expect(ctx.filePath).toBe(FEATURE_PATH)

    expect(column).toEqual(REVIEW_COLUMN)
    expect(extensionRoot).toBe(EXTENSION_ROOT)
    expect(workspaceRoot).toBe(WORKSPACE_ROOT)
    expect(settingsTemplate).toBeUndefined()
  })

  it('passes column.prompt as settingsTemplate when column has a custom prompt', async () => {
    const customColumns = DEFAULT_COLUMNS.map(c =>
      c.id === 'review' ? { ...c, prompt: 'Custom: {{title}}' } : c
    )
    const configMock = {
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === 'columns') return customColumns
        if (key === 'featuresDirectory') return '.devtool/features'
        return defaultValue
      })
    }
    mockGetConfiguration.mockReturnValue(configMock)
    mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: WORKSPACE_ROOT } })

    const extensionUri = { fsPath: EXTENSION_ROOT } as import('vscode').Uri
    const provider = new FeatureHeaderProvider(extensionUri)

    const webviewView = makeWebviewView()
    provider.resolveWebviewView(
      webviewView,
      {} as import('vscode').WebviewViewResolveContext,
      { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as import('vscode').CancellationToken
    )

    const providerAny = provider as unknown as { _currentDocument: import('vscode').TextDocument }
    providerAny._currentDocument = makeDocument()

    await capturedMessageHandler!({ type: 'startWithAI', agent: 'claude', permissionMode: 'default' })

    const [, , , , settingsTemplate] = mockBuildPrompt.mock.calls[0]
    expect(settingsTemplate).toBe('Custom: {{title}}')
  })

  it('uses workspaceRoot from getWorkspaceFolder for terminal cwd', async () => {
    const configMock = {
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === 'columns') return DEFAULT_COLUMNS
        return defaultValue
      })
    }
    mockGetConfiguration.mockReturnValue(configMock)
    mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: '/custom-workspace' } })

    const extensionUri = { fsPath: EXTENSION_ROOT } as import('vscode').Uri
    const provider = new FeatureHeaderProvider(extensionUri)

    const webviewView = makeWebviewView()
    provider.resolveWebviewView(
      webviewView,
      {} as import('vscode').WebviewViewResolveContext,
      { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as import('vscode').CancellationToken
    )

    const providerAny = provider as unknown as { _currentDocument: import('vscode').TextDocument }
    providerAny._currentDocument = makeDocument()

    await capturedMessageHandler!({ type: 'startWithAI', agent: 'claude', permissionMode: 'default' })

    expect(mockCreateTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/custom-workspace',
        name: 'Review: My Review Feature'
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Security: shellArgs injection and workspace trust guard
// ---------------------------------------------------------------------------

describe('FeatureHeaderProvider startWithAI security', () => {
  function makeDocumentWithTitle(title: string) {
    const content = [
      '---',
      'id: security-test',
      'status: review',
      'priority: high',
      'assignee: null',
      'epic: null',
      'dueDate: null',
      'created: 2026-01-01T00:00:00.000Z',
      'modified: 2026-01-01T00:00:00.000Z',
      'completedAt: null',
      'labels: []',
      'order: a0',
      '---',
      '',
      `# ${title}`,
      '',
      'Feature description.'
    ].join('\n')
    return makeDocument(content, FEATURE_PATH)
  }

  function setupProvider() {
    const configMock = {
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === 'columns') return DEFAULT_COLUMNS
        if (key === 'featuresDirectory') return '.devtool/features'
        return defaultValue
      })
    }
    mockGetConfiguration.mockReturnValue(configMock)
    mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: WORKSPACE_ROOT } })

    const extensionUri = { fsPath: EXTENSION_ROOT } as import('vscode').Uri
    const provider = new FeatureHeaderProvider(extensionUri)

    const webviewView = makeWebviewView()
    provider.resolveWebviewView(
      webviewView,
      {} as import('vscode').WebviewViewResolveContext,
      { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as import('vscode').CancellationToken
    )

    return provider
  }

  it('passes the prompt as a literal shellArgs element without shell quoting', async () => {
    // buildPrompt is mocked to return 'mocked prompt'.
    // The point of this test is to verify that whatever buildPrompt returns is
    // passed as-is in shellArgs — no POSIX single-quote escaping applied —
    // and that shellPath is the bare agent binary name.
    mockIsTrusted.value = true

    // Make buildPrompt return a string containing metacharacters so we can
    // confirm they survive unescaped into shellArgs.
    const dangerousPrompt = `hello "world" 'single' \`cmd\` $HOME; rm -rf . && echo | test`
    mockBuildPrompt.mockReturnValueOnce(dangerousPrompt)

    const provider = setupProvider()

    const providerAny = provider as unknown as { _currentDocument: import('vscode').TextDocument }
    providerAny._currentDocument = makeDocument()

    await capturedMessageHandler!({ type: 'startWithAI', agent: 'claude', permissionMode: 'default' })

    expect(mockCreateTerminal).toHaveBeenCalledOnce()
    const opts = mockCreateTerminal.mock.calls[0][0]

    // The prompt must appear verbatim as a shellArgs element
    const shellArgs: string[] = opts.shellArgs
    expect(shellArgs).toContain(dangerousPrompt)

    // No POSIX single-quote shell escaping should be present
    expect(shellArgs.join(' ')).not.toContain("'\\''")

    // shellPath must be the agent binary name — no shell wrapping
    expect(opts.shellPath).toBe('claude')
  })

  it('blocks launch and shows warning when workspace is not trusted', async () => {
    mockIsTrusted.value = false

    const provider = setupProvider()

    const providerAny = provider as unknown as { _currentDocument: import('vscode').TextDocument }
    providerAny._currentDocument = makeDocument()

    await capturedMessageHandler!({ type: 'startWithAI', agent: 'claude', permissionMode: 'default' })

    expect(mockCreateTerminal).not.toHaveBeenCalled()
    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
  })

  it('creates terminal when workspace is trusted', async () => {
    mockIsTrusted.value = true

    const provider = setupProvider()

    const providerAny = provider as unknown as { _currentDocument: import('vscode').TextDocument }
    providerAny._currentDocument = makeDocument()

    await capturedMessageHandler!({ type: 'startWithAI', agent: 'claude', permissionMode: 'default' })

    expect(mockCreateTerminal).toHaveBeenCalledOnce()
    expect(mockShowWarningMessage).not.toHaveBeenCalled()
  })
})
