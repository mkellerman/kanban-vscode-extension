/**
 * Tests that KanbanPanel surfaces filesystem write failures to the user
 * instead of silently swallowing them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoist shared mocks
// ---------------------------------------------------------------------------
const {
  mockWriteFile,
  mockReadDirectory,
  mockCreateDirectory,
  mockShowErrorMessage,
  mockShowWarningMessage,
  mockPostMessage,
  mockGetConfiguration,
} = vi.hoisted(() => ({
  mockWriteFile: vi.fn(() => Promise.resolve()),
  mockReadDirectory: vi.fn(() => Promise.resolve([])),
  mockCreateDirectory: vi.fn(() => Promise.resolve()),
  mockShowErrorMessage: vi.fn(),
  mockShowWarningMessage: vi.fn(),
  mockPostMessage: vi.fn(),
  mockGetConfiguration: vi.fn(),
}))

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
        asWebviewUri: (uri: { fsPath: string }) => uri,
      },
      onDidDispose: vi.fn(),
      iconPath: undefined,
      reveal: vi.fn(),
    })),
    showErrorMessage: mockShowErrorMessage,
    showWarningMessage: mockShowWarningMessage,
  },
  workspace: {
    getConfiguration: mockGetConfiguration,
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    createFileSystemWatcher: vi.fn(() => ({
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
      onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    })),
    fs: {
      writeFile: mockWriteFile,
      readDirectory: mockReadDirectory,
      createDirectory: mockCreateDirectory,
      readFile: vi.fn(() => Promise.resolve(new Uint8Array())),
      stat: vi.fn(() => Promise.reject(new Error('not found'))),
      delete: vi.fn(() => Promise.resolve()),
      rename: vi.fn(() => Promise.resolve()),
    },
  },
  Uri: {
    file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/'),
    }),
  },
  ViewColumn: { One: 1, Two: 2, Beside: -2 },
  FileType: { File: 1, Directory: 2 },
  RelativePattern: class RelativePattern {
    constructor(public base: unknown, public pattern: string) {}
  },
}))

// Also mock fs (required because l10n.ts imports it at module level)
vi.mock('fs')

// ---------------------------------------------------------------------------
// Import subject after mocks
// ---------------------------------------------------------------------------
import { KanbanPanel } from '../../src/extension/KanbanPanel'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const WORKSPACE_ROOT = '/workspace'
const FEATURES_DIR = `${WORKSPACE_ROOT}/.devtool/features`

function makeConfigMock() {
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => defaultValue),
  }
}

function makeContext() {
  return {
    extensionUri: { fsPath: '/ext' },
    workspaceState: {
      get: vi.fn((_key: string, def: unknown) => def),
      update: vi.fn(() => Promise.resolve()),
    },
    subscriptions: [],
  } as unknown as import('vscode').ExtensionContext
}

function makeFeature(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-feature',
    status: 'backlog',
    priority: 'medium',
    assignee: null,
    epic: null,
    dueDate: null,
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    labels: [],
    order: 'a0',
    content: '# Test Feature',
    filePath: `${FEATURES_DIR}/test-feature.md`,
    ...overrides,
  }
}

function createPanel() {
  const extensionUri = { fsPath: '/ext' } as import('vscode').Uri
  const context = makeContext()
  KanbanPanel.createOrShow(extensionUri, context)
  return KanbanPanel.currentPanel!
}

beforeEach(() => {
  vi.clearAllMocks()
  KanbanPanel.currentPanel = undefined
  mockGetConfiguration.mockReturnValue(makeConfigMock())
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KanbanPanel file error surfacing', () => {
  it('shows error and does not push feature when writeFile fails in _createFeature', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('disk full'))

    const panel = createPanel()
    const panelAny = panel as any
    panelAny._features = []

    await panelAny._createFeature({
      status: 'backlog',
      priority: 'medium',
      content: '# New Card',
      assignee: null,
      epic: null,
      dueDate: null,
      labels: [],
    })

    expect(mockShowErrorMessage).toHaveBeenCalledOnce()
    expect(mockShowErrorMessage.mock.calls[0][0]).toBe('panel.createFailed')
    expect(panelAny._features).toHaveLength(0)
  })

  it('shows error and reloads when writeFile fails in _moveFeature', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('permission denied'))

    const panel = createPanel()
    const panelAny = panel as any
    panelAny._features = [makeFeature({ id: 'feat-1', status: 'backlog' })]

    const spyLoad = vi.spyOn(panelAny, '_loadFeatures').mockResolvedValue(undefined)
    vi.spyOn(panelAny, '_sendFeaturesToWebview').mockImplementation(() => {})

    await panelAny._moveFeature('feat-1', 'todo', 0)

    expect(mockShowErrorMessage).toHaveBeenCalledOnce()
    expect(mockShowErrorMessage.mock.calls[0][0]).toBe('panel.moveFailed')
    expect(spyLoad).toHaveBeenCalledOnce()
  })

  it('shows error and reloads when writeFile fails in _updateFeature', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('read-only filesystem'))

    const panel = createPanel()
    const panelAny = panel as any
    panelAny._features = [makeFeature({ id: 'feat-1' })]

    const spyLoad = vi.spyOn(panelAny, '_loadFeatures').mockResolvedValue(undefined)
    vi.spyOn(panelAny, '_sendFeaturesToWebview').mockImplementation(() => {})

    await panelAny._updateFeature('feat-1', { priority: 'high' })

    expect(mockShowErrorMessage).toHaveBeenCalledOnce()
    expect(mockShowErrorMessage.mock.calls[0][0]).toBe('panel.updateFailed')
    expect(spyLoad).toHaveBeenCalledOnce()
  })

  it('shows error and reloads when writeFile fails in _saveFeatureContent', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('no space left'))

    const panel = createPanel()
    const panelAny = panel as any
    const feature = makeFeature({ id: 'feat-1' })
    panelAny._features = [feature]

    const spyLoad = vi.spyOn(panelAny, '_loadFeatures').mockResolvedValue(undefined)
    vi.spyOn(panelAny, '_sendFeaturesToWebview').mockImplementation(() => {})

    await panelAny._saveFeatureContent('feat-1', '# Updated', {
      id: 'feat-1',
      status: 'backlog',
      priority: 'medium',
      assignee: null,
      epic: null,
      dueDate: null,
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:00:00.000Z',
      completedAt: null,
      labels: [],
      order: 'a0',
    })

    expect(mockShowErrorMessage).toHaveBeenCalledOnce()
    expect(mockShowErrorMessage.mock.calls[0][0]).toBe('panel.saveFailed')
    expect(spyLoad).toHaveBeenCalledOnce()
  })

  it('shows warning with count and reloads when a writeFile fails in _moveAllCards', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('disk full'))

    const panel = createPanel()
    const panelAny = panel as any
    panelAny._features = [makeFeature({ id: 'feat-1', status: 'backlog', order: 'a0' })]

    const spyLoad = vi.spyOn(panelAny, '_loadFeatures').mockResolvedValue(undefined)
    vi.spyOn(panelAny, '_sendFeaturesToWebview').mockImplementation(() => {})

    await panelAny._moveAllCards('backlog', 'todo')

    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
    expect(mockShowWarningMessage.mock.calls[0][0]).toBe('panel.moveAllFailedOne')
    expect(spyLoad).toHaveBeenCalledOnce()
  })

  it('shows warning with count and reloads when a writeFile fails in _renameLabel', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('disk full'))

    const panel = createPanel()
    const panelAny = panel as any
    panelAny._features = [
      makeFeature({ id: 'feat-1', labels: ['bug'] }),
    ]

    const spyLoad = vi.spyOn(panelAny, '_loadFeatures').mockResolvedValue(undefined)
    vi.spyOn(panelAny, '_sendFeaturesToWebview').mockImplementation(() => {})

    await panelAny._renameLabel('bug', 'defect')

    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
    expect(mockShowWarningMessage.mock.calls[0][0]).toBe('panel.renameLabelFailedOne')
    expect(spyLoad).toHaveBeenCalledOnce()
  })

  it('shows warning with count and reloads when a writeFile fails in _deleteLabel', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('disk full'))
    // _deleteLabel shows a confirmation dialog first; mock it to confirm
    mockShowWarningMessage.mockResolvedValueOnce('panel.removeButton')

    const panel = createPanel()
    const panelAny = panel as any
    panelAny._features = [
      makeFeature({ id: 'feat-1', labels: ['obsolete'] }),
    ]

    const spyLoad = vi.spyOn(panelAny, '_loadFeatures').mockResolvedValue(undefined)
    vi.spyOn(panelAny, '_sendFeaturesToWebview').mockImplementation(() => {})

    await panelAny._deleteLabel('obsolete')

    // Second showWarningMessage call is the failure notification
    const warnCalls = mockShowWarningMessage.mock.calls
    const failureCall = warnCalls.find(c => c[0] === 'panel.deleteLabelFailedOne')
    expect(failureCall).toBeDefined()
    expect(spyLoad).toHaveBeenCalledOnce()
  })

  it('shows error and clears features when _loadFeatures fails', async () => {
    mockCreateDirectory.mockRejectedValueOnce(new Error('access denied'))

    const panel = createPanel()
    const panelAny = panel as any
    panelAny._features = [makeFeature()]

    await panelAny._loadFeatures()

    expect(mockShowErrorMessage).toHaveBeenCalledOnce()
    expect(mockShowErrorMessage.mock.calls[0][0]).toBe('panel.loadFailed')
    expect(panelAny._features).toHaveLength(0)
  })

  it('shows plural warning when multiple writeFiles fail in _moveAllCards', async () => {
    mockWriteFile.mockRejectedValue(new Error('disk full'))

    const panel = createPanel()
    const panelAny = panel as any
    panelAny._features = [
      makeFeature({ id: 'feat-1', status: 'backlog', order: 'a0' }),
      makeFeature({ id: 'feat-2', status: 'backlog', order: 'a1' }),
    ]

    const spyLoad = vi.spyOn(panelAny, '_loadFeatures').mockResolvedValue(undefined)
    vi.spyOn(panelAny, '_sendFeaturesToWebview').mockImplementation(() => {})

    await panelAny._moveAllCards('backlog', 'todo')

    mockWriteFile.mockResolvedValue(undefined)
    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
    expect(mockShowWarningMessage.mock.calls[0][0]).toBe('panel.moveAllFailedOther')
    expect(spyLoad).toHaveBeenCalledOnce()
  })

  it('shows plural warning when multiple writeFiles fail in _renameLabel', async () => {
    mockWriteFile.mockRejectedValue(new Error('disk full'))

    const panel = createPanel()
    const panelAny = panel as any
    panelAny._features = [
      makeFeature({ id: 'feat-1', labels: ['bug'] }),
      makeFeature({ id: 'feat-2', labels: ['bug'] }),
    ]

    const spyLoad = vi.spyOn(panelAny, '_loadFeatures').mockResolvedValue(undefined)
    vi.spyOn(panelAny, '_sendFeaturesToWebview').mockImplementation(() => {})

    await panelAny._renameLabel('bug', 'defect')

    mockWriteFile.mockResolvedValue(undefined)
    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
    expect(mockShowWarningMessage.mock.calls[0][0]).toBe('panel.renameLabelFailedOther')
    expect(spyLoad).toHaveBeenCalledOnce()
  })

  it('shows plural warning when multiple writeFiles fail in _deleteLabel', async () => {
    mockWriteFile.mockRejectedValue(new Error('disk full'))
    mockShowWarningMessage.mockResolvedValueOnce('panel.removeButton')

    const panel = createPanel()
    const panelAny = panel as any
    panelAny._features = [
      makeFeature({ id: 'feat-1', labels: ['obsolete'] }),
      makeFeature({ id: 'feat-2', labels: ['obsolete'] }),
    ]

    const spyLoad = vi.spyOn(panelAny, '_loadFeatures').mockResolvedValue(undefined)
    vi.spyOn(panelAny, '_sendFeaturesToWebview').mockImplementation(() => {})

    await panelAny._deleteLabel('obsolete')

    mockWriteFile.mockResolvedValue(undefined)
    const warnCalls = mockShowWarningMessage.mock.calls
    const failureCall = warnCalls.find(c => c[0] === 'panel.deleteLabelFailedOther')
    expect(failureCall).toBeDefined()
    expect(spyLoad).toHaveBeenCalledOnce()
  })
})
