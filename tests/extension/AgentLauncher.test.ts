import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Feature, KanbanColumn } from '../../src/shared/types'
import type * as vscode from 'vscode'

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

const { mockBuildPrompt, mockBuildLanePrompt } = vi.hoisted(() => ({
  mockBuildPrompt: vi.fn(() => 'the-prompt'),
  mockBuildLanePrompt: vi.fn(() => 'the-lane-prompt')
}))
vi.mock('../../src/extension/ai/promptBuilder', () => ({
  buildPrompt: mockBuildPrompt,
  buildLanePrompt: mockBuildLanePrompt
}))
vi.mock('fs')

import * as fs from 'fs'
import { AgentLauncher } from '../../src/extension/AgentLauncher'

const REVIEW_FEATURE: Feature = {
  id: 'my-feat',
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
  workspace: null,
  content: '# My Feature\n\nDesc.',
  filePath: '/workspace/.kanban/features/my-feat.md'
}

const BACKLOG_COLUMN: KanbanColumn = { id: 'backlog', name: 'Backlog', color: '#6b7280' }

const BACKLOG_FEATURE: Feature = {
  id: 'feat-backlog', status: 'backlog', priority: 'medium', assignee: null, epic: null,
  dueDate: null, created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z',
  completedAt: null, labels: [], order: 'a1', workspace: null, content: '# Backlog Feature',
  filePath: '/workspace/.kanban/features/feat-backlog.md'
}

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

beforeEach(() => {
  vi.clearAllMocks()
  mockIsTrusted.value = true
})

describe('AgentLauncher.launch()', () => {
  it('calls buildPrompt with the correct context and column', () => {
    const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
    launcher.launch(REVIEW_FEATURE, 'claude', 'default')

    expect(mockBuildPrompt).toHaveBeenCalledOnce()
    const [ctx, column, extensionRoot] = mockBuildPrompt.mock.calls[0]
    expect(ctx.title).toBe('My Feature')
    expect(ctx.status).toBe('review')
    expect(column.id).toBe('review')
    expect(extensionRoot).toBe('/ext')
  })

  it('creates a terminal with the feature title and column name', () => {
    const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
    launcher.launch(REVIEW_FEATURE, 'claude', 'default')

    expect(mockCreateTerminal).toHaveBeenCalledOnce()
    const opts = mockCreateTerminal.mock.calls[0][0]
    expect(opts.name).toBe('Review: My Feature')
    expect(opts.shellPath).toBe('claude')
    expect(opts.cwd).toBe('/workspace')
  })

  it('does NOT call buildPrompt when workspace is not trusted', () => {
    mockIsTrusted.value = false
    const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
    launcher.launch(REVIEW_FEATURE, 'claude', 'default')
    expect(mockBuildPrompt).not.toHaveBeenCalled()
    expect(mockCreateTerminal).not.toHaveBeenCalled()
    expect(mockShowWarningMessage).toHaveBeenCalledOnce()
  })

  it('passes the prompt verbatim as a shellArgs element (no shell quoting)', () => {
    const dangerous = `hello "world" 'single' \`cmd\` $VAR; rm -rf`
    mockBuildPrompt.mockReturnValueOnce(dangerous)
    const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
    launcher.launch(REVIEW_FEATURE, 'claude', 'default')
    const opts = mockCreateTerminal.mock.calls[0][0]
    expect(opts.shellArgs).toContain(dangerous)
    expect(opts.shellArgs.join(' ')).not.toContain("'\\''")
  })

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
    launcher.launch(REVIEW_FEATURE, 'claude', 'default')
    const opts = mockCreateTerminal.mock.calls[0][0]
    expect(opts.cwd).toBe('/workspace')
  })
})

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

  it('falls back to workspaceFolders[0] for cwd when getWorkspaceFolder returns null', () => {
    mockGetWorkspaceFolder.mockReturnValueOnce(null)
    const launcher = new AgentLauncher({ fsPath: '/ext' } as import('vscode').Uri)
    launcher.launchLane([BACKLOG_FEATURE], BACKLOG_COLUMN, 'claude', 'default')
    const opts = mockCreateTerminal.mock.calls[0][0]
    expect(opts.cwd).toBe('/workspace')
  })
})

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

  it('does not fire active:false for a feature id still active in another terminal', () => {
    const f2 = { ...REVIEW_FEATURE, id: 'feat-2' }
    const column: KanbanColumn = { id: 'review', name: 'Review', color: '#8b5cf6' }
    // terminal 1 tracks REVIEW_FEATURE ('my-feat')
    launcher.launch(REVIEW_FEATURE, 'claude', 'default')
    const terminal1 = mockCreateTerminal.mock.results[0].value
    // terminal 2 tracks REVIEW_FEATURE ('my-feat') AND f2 ('feat-2')
    launcher.launchLane([REVIEW_FEATURE, f2], column, 'claude', 'default')
    const terminal2 = mockCreateTerminal.mock.results[1].value
    vi.clearAllMocks()
    statusListener.mockClear()

    // close terminal 2 — 'feat-2' becomes inactive, but 'my-feat' is still in terminal 1
    captureTerminalClose.fn!(terminal2)
    expect(statusListener).toHaveBeenCalledOnce()
    expect(statusListener.mock.calls[0][0]).toEqual({
      featureIds: ['feat-2'],
      active: false
    })

    // close terminal 1 — now 'my-feat' truly becomes inactive
    captureTerminalClose.fn!(terminal1)
    expect(statusListener).toHaveBeenCalledTimes(2)
    expect(statusListener.mock.calls[1][0]).toEqual({
      featureIds: ['my-feat'],
      active: false
    })
  })
})
