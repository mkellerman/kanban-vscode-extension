/**
 * Wiring test: asserts that KanbanPanel._startWithAI calls buildPrompt with the
 * correct arguments (column, extensionRoot, workspaceRoot, settingsTemplate).
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

// ---------------------------------------------------------------------------
// Mock vscode before any other imports
// ---------------------------------------------------------------------------
vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn(() => ({
      webview: {
        options: {},
        html: '',
        onDidReceiveMessage: vi.fn(),
        postMessage: mockPostMessage,
        asWebviewUri: (uri: { fsPath: string }) => uri
      },
      onDidDispose: vi.fn(),
      iconPath: undefined,
      reveal: vi.fn()
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
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    createFileSystemWatcher: vi.fn(() => ({
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
      onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn()
    }))
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
  }
}))

// ---------------------------------------------------------------------------
// Mock promptBuilder so we can spy on buildPrompt
// ---------------------------------------------------------------------------
const { mockBuildPrompt } = vi.hoisted(() => {
  return { mockBuildPrompt: vi.fn(() => 'mocked prompt result') }
})

vi.mock('../../src/extension/ai/promptBuilder', () => ({
  buildPrompt: mockBuildPrompt
}))

// ---------------------------------------------------------------------------
// Also mock fs (required because promptBuilder imports it at module level)
// ---------------------------------------------------------------------------
vi.mock('fs')

// ---------------------------------------------------------------------------
// Import subject after mocks are set up
// ---------------------------------------------------------------------------
import { KanbanPanel } from '../../src/extension/KanbanPanel'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXTENSION_ROOT = '/ext'
const WORKSPACE_ROOT = '/workspace'

const REVIEW_COLUMN = { id: 'review', name: 'Review', color: '#8b5cf6' }
const DEFAULT_COLUMNS = [
  { id: 'backlog', name: 'Backlog', color: '#6b7280' },
  { id: 'todo', name: 'To Do', color: '#3b82f6' },
  { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
  { id: 'review', name: 'Review', color: '#8b5cf6' },
  { id: 'done', name: 'Done', color: '#22c55e' }
]

function makeConfigMock(columns = DEFAULT_COLUMNS) {
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => {
      if (key === 'columns') return columns
      if (key === 'aiAgent') return 'claude'
      return defaultValue
    })
  }
}

function makeContext() {
  return {
    extensionUri: { fsPath: EXTENSION_ROOT },
    workspaceState: {
      get: vi.fn((_key: string, def: unknown) => def),
      update: vi.fn(() => Promise.resolve())
    },
    subscriptions: []
  } as unknown as import('vscode').ExtensionContext
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsTrusted.value = true
  KanbanPanel.currentPanel = undefined
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KanbanPanel._startWithAI wiring', () => {
  it('calls buildPrompt with the review column, extensionRoot, workspaceRoot, and column.prompt', async () => {
    const configMock = makeConfigMock()
    mockGetConfiguration.mockReturnValue(configMock)
    mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: WORKSPACE_ROOT } })

    const extensionUri = { fsPath: EXTENSION_ROOT } as import('vscode').Uri
    const context = makeContext()

    KanbanPanel.createOrShow(extensionUri, context)
    const panel = KanbanPanel.currentPanel!

    // Inject a feature in review status directly
    const reviewFeature = {
      id: 'my-review-feature',
      status: 'review',
      priority: 'high',
      assignee: null,
      epic: null,
      dueDate: null,
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:00:00.000Z',
      completedAt: null,
      labels: ['bug'],
      order: 'a0',
      content: '# My Review Feature\nSome description',
      filePath: `${WORKSPACE_ROOT}/.devtool/features/my-review-feature.md`
    }

    const panelAny = panel as unknown as {
      _features: typeof reviewFeature[]
      _currentEditingFeatureId: string | null
      _startWithAI: (agent?: string, permissionMode?: string) => Promise<void>
    }

    panelAny._features = [reviewFeature]
    panelAny._currentEditingFeatureId = 'my-review-feature'

    await panelAny._startWithAI('claude', 'default')

    expect(mockBuildPrompt).toHaveBeenCalledOnce()

    const [ctx, column, extensionRoot, workspaceRoot, settingsTemplate] = mockBuildPrompt.mock.calls[0]

    expect(ctx.title).toBe('My Review Feature')
    expect(ctx.status).toBe('review')
    expect(ctx.priority).toBe('high')
    expect(ctx.labels).toEqual(['bug'])
    expect(ctx.filePath).toBe(`${WORKSPACE_ROOT}/.devtool/features/my-review-feature.md`)

    expect(column).toEqual(REVIEW_COLUMN)
    expect(extensionRoot).toBe(EXTENSION_ROOT)
    expect(workspaceRoot).toBe(WORKSPACE_ROOT)
    expect(settingsTemplate).toBeUndefined()
  })

  it('passes column.prompt as settingsTemplate when column has a custom prompt', async () => {
    const customColumns = DEFAULT_COLUMNS.map(c =>
      c.id === 'review' ? { ...c, prompt: 'Custom review: {{title}}' } : c
    )
    const configMock = makeConfigMock(customColumns)
    mockGetConfiguration.mockReturnValue(configMock)
    mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: WORKSPACE_ROOT } })

    const extensionUri = { fsPath: EXTENSION_ROOT } as import('vscode').Uri
    const context = makeContext()

    KanbanPanel.createOrShow(extensionUri, context)
    const panel = KanbanPanel.currentPanel!

    const reviewFeature = {
      id: 'feat',
      status: 'review',
      priority: 'medium',
      assignee: null,
      epic: null,
      dueDate: null,
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:00:00.000Z',
      completedAt: null,
      labels: [],
      order: 'a0',
      content: '# Feat',
      filePath: `${WORKSPACE_ROOT}/.devtool/features/feat.md`
    }

    const panelAny = panel as unknown as {
      _features: typeof reviewFeature[]
      _currentEditingFeatureId: string | null
      _startWithAI: (agent?: string, permissionMode?: string) => Promise<void>
    }

    panelAny._features = [reviewFeature]
    panelAny._currentEditingFeatureId = 'feat'

    await panelAny._startWithAI('claude', 'default')

    const [, , , , settingsTemplate] = mockBuildPrompt.mock.calls[0]
    expect(settingsTemplate).toBe('Custom review: {{title}}')
  })

  it('uses workspaceRoot from getWorkspaceFolder for terminal cwd', async () => {
    const configMock = makeConfigMock()
    mockGetConfiguration.mockReturnValue(configMock)
    mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: '/custom-workspace' } })

    const extensionUri = { fsPath: EXTENSION_ROOT } as import('vscode').Uri
    const context = makeContext()

    KanbanPanel.createOrShow(extensionUri, context)
    const panel = KanbanPanel.currentPanel!

    const feature = {
      id: 'feat',
      status: 'review',
      priority: 'low',
      assignee: null,
      epic: null,
      dueDate: null,
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:00:00.000Z',
      completedAt: null,
      labels: [],
      order: 'a0',
      content: '# Feat',
      filePath: '/custom-workspace/.devtool/features/feat.md'
    }

    const panelAny = panel as unknown as {
      _features: typeof feature[]
      _currentEditingFeatureId: string | null
      _startWithAI: () => Promise<void>
    }

    panelAny._features = [feature]
    panelAny._currentEditingFeatureId = 'feat'

    await panelAny._startWithAI()

    expect(mockCreateTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/custom-workspace',
        name: 'Review: Feat'
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Security: shellArgs injection and workspace trust guard
// ---------------------------------------------------------------------------

describe('KanbanPanel._startWithAI security', () => {
  function makeFeatureWithTitle(title: string) {
    return {
      id: 'security-test',
      status: 'review',
      priority: 'high',
      assignee: null,
      epic: null,
      dueDate: null,
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:00:00.000Z',
      completedAt: null,
      labels: [],
      order: 'a0',
      content: `# ${title}\nSome description`,
      filePath: `${WORKSPACE_ROOT}/.devtool/features/security-test.md`
    }
  }

  it('passes the prompt as a literal shellArgs element without shell quoting', async () => {
    // buildPrompt is mocked to return 'mocked prompt result'.
    // The point of this test is to verify that whatever buildPrompt returns is
    // passed as-is in shellArgs — no POSIX single-quote escaping applied —
    // and that shellPath is the bare agent binary name.
    const configMock = makeConfigMock()
    mockGetConfiguration.mockReturnValue(configMock)
    mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: WORKSPACE_ROOT } })
    mockIsTrusted.value = true

    // Make buildPrompt return a string containing metacharacters so we can
    // confirm they survive unescaped into shellArgs.
    const dangerousPrompt = `hello "world" 'single' \`cmd\` $HOME; rm -rf . && echo | test`
    mockBuildPrompt.mockReturnValueOnce(dangerousPrompt)

    const extensionUri = { fsPath: EXTENSION_ROOT } as import('vscode').Uri
    const context = makeContext()

    KanbanPanel.createOrShow(extensionUri, context)
    const panel = KanbanPanel.currentPanel!

    const feature = makeFeatureWithTitle('Normal title')

    const panelAny = panel as unknown as {
      _features: typeof feature[]
      _currentEditingFeatureId: string | null
      _startWithAI: (agent?: string, permissionMode?: string) => Promise<void>
    }

    panelAny._features = [feature]
    panelAny._currentEditingFeatureId = 'security-test'

    await panelAny._startWithAI('claude', 'default')

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
    const configMock = makeConfigMock()
    mockGetConfiguration.mockReturnValue(configMock)
    mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: WORKSPACE_ROOT } })
    mockIsTrusted.value = false

    const extensionUri = { fsPath: EXTENSION_ROOT } as import('vscode').Uri
    const context = makeContext()

    KanbanPanel.createOrShow(extensionUri, context)
    const panel = KanbanPanel.currentPanel!

    const feature = makeFeatureWithTitle('Normal title')

    const panelAny = panel as unknown as {
      _features: typeof feature[]
      _currentEditingFeatureId: string | null
      _startWithAI: (agent?: string, permissionMode?: string) => Promise<void>
    }

    panelAny._features = [feature]
    panelAny._currentEditingFeatureId = 'security-test'

    await panelAny._startWithAI('claude', 'default')

    expect(mockCreateTerminal).not.toHaveBeenCalled()
    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
  })

  it('creates terminal when workspace is trusted', async () => {
    const configMock = makeConfigMock()
    mockGetConfiguration.mockReturnValue(configMock)
    mockGetWorkspaceFolder.mockReturnValue({ uri: { fsPath: WORKSPACE_ROOT } })
    mockIsTrusted.value = true

    const extensionUri = { fsPath: EXTENSION_ROOT } as import('vscode').Uri
    const context = makeContext()

    KanbanPanel.createOrShow(extensionUri, context)
    const panel = KanbanPanel.currentPanel!

    const feature = makeFeatureWithTitle('Normal title')

    const panelAny = panel as unknown as {
      _features: typeof feature[]
      _currentEditingFeatureId: string | null
      _startWithAI: (agent?: string, permissionMode?: string) => Promise<void>
    }

    panelAny._features = [feature]
    panelAny._currentEditingFeatureId = 'security-test'

    await panelAny._startWithAI('claude', 'default')

    expect(mockCreateTerminal).toHaveBeenCalledOnce()
    expect(mockShowWarningMessage).not.toHaveBeenCalled()
  })
})
