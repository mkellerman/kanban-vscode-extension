import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Feature, KanbanColumn } from '../../src/shared/types'

const { mockCreateTerminal, mockShowWarningMessage, mockShow, mockIsTrusted } = vi.hoisted(() => {
  const mockShow = vi.fn()
  const mockCreateTerminal = vi.fn(() => ({ show: mockShow }))
  const mockShowWarningMessage = vi.fn()
  const mockIsTrusted = { value: true }
  return { mockCreateTerminal, mockShowWarningMessage, mockShow, mockIsTrusted }
})

vi.mock('vscode', () => ({
  window: { createTerminal: mockCreateTerminal, showWarningMessage: mockShowWarningMessage },
  workspace: {
    get isTrusted() { return mockIsTrusted.value },
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    getWorkspaceFolder: vi.fn(() => ({ uri: { fsPath: '/workspace' } })),
    getConfiguration: vi.fn(() => ({
      get: (key: string, def: unknown) => key === 'columns' ? [
        { id: 'backlog', name: 'Backlog', color: '#6b7280' },
        { id: 'review', name: 'Review', color: '#8b5cf6' }
      ] : def
    }))
  },
  Uri: { file: (p: string) => ({ fsPath: p }) },
  Disposable: { from: (...d: { dispose: () => void }[]) => ({ dispose: () => d.forEach(x => x.dispose()) }) }
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
  content: '# My Feature\n\nDesc.',
  filePath: '/workspace/.kanban/features/my-feat.md'
}

const BACKLOG_COLUMN: KanbanColumn = { id: 'backlog', name: 'Backlog', color: '#6b7280' }

const BACKLOG_FEATURE: Feature = {
  id: 'feat-backlog', status: 'backlog', priority: 'medium', assignee: null, epic: null,
  dueDate: null, created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z',
  completedAt: null, labels: [], order: 'a1', content: '# Backlog Feature',
  filePath: '/workspace/.kanban/features/feat-backlog.md'
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
})
