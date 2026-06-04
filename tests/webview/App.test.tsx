// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import App from '../../src/webview/App'
import { useStore } from '../../src/webview/store'
import type { FeatureFrontmatter, KanbanColumn } from '../../src/shared/types'

const { mockPostMessage } = vi.hoisted(() => ({ mockPostMessage: vi.fn() }))

vi.mock('../../src/webview/vscodeApi', () => ({
  vscode: { postMessage: mockPostMessage },
}))

vi.mock('../../src/webview/components/FeatureEditor', () => ({
  FeatureEditor: ({ featureId }: { featureId: string }) => (
    <div data-testid="feature-editor" data-feature-id={featureId} />
  ),
}))

vi.mock('../../src/webview/components/KanbanBoard', () => ({
  KanbanBoard: () => <div data-testid="kanban-board" />,
}))

vi.mock('../../src/webview/components/KanbanEpicBoard', () => ({
  KanbanEpicBoard: () => <div data-testid="kanban-epic-board" />,
}))

vi.mock('../../src/webview/components/CreateFeatureDialog', () => ({
  CreateFeatureDialog: () => null,
}))

vi.mock('../../src/webview/components/Toolbar', () => ({
  Toolbar: () => <div data-testid="toolbar" />,
}))

vi.mock('../../src/webview/components/UndoToast', () => ({
  UndoToast: () => null,
}))

const initialState = useStore.getState()

const COLUMNS: KanbanColumn[] = [
  { id: 'backlog', name: 'Backlog', color: '#6b7280' },
  { id: 'todo', name: 'To Do', color: '#3b82f6' },
]

const INIT_SETTINGS = {
  showPriorityBadges: false,
  showAssignee: false,
  showDueDate: false,
  showLabels: false,
  showEpic: false,
  showBuildWithAI: false,
  showFileName: false,
  compactMode: false,
  markdownEditorMode: false,
  hideScrollbar: false,
  defaultPriority: 'medium' as const,
  defaultStatus: 'backlog' as const,
}

function dispatchInit() {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: {
        type: 'init',
        features: [],
        columns: COLUMNS,
        settings: INIT_SETTINGS,
        collapsedColumns: [],
        collapsedEpics: [],
        boardViewMode: 'standard',
        locale: 'en',
        translations: {},
      },
    })
  )
}

beforeEach(() => {
  useStore.setState(initialState, true)
  mockPostMessage.mockClear()
})

const FRONTMATTER: FeatureFrontmatter = {
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
}

describe('App', () => {
  it('shows FeatureEditor when featureContent message is received', async () => {
    render(<App />)

    act(() => { dispatchInit() })
    await waitFor(() => expect(screen.getByTestId('kanban-board')).toBeInTheDocument())

    expect(screen.queryByTestId('feature-editor')).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'featureContent',
            featureId: 'feat-1',
            content: '# Feature 1',
            frontmatter: FRONTMATTER,
          },
        })
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('feature-editor')).toBeInTheDocument()
    })
    expect(screen.getByTestId('feature-editor')).toHaveAttribute('data-feature-id', 'feat-1')
  })

  it('keeps FeatureEditor visible while editing feature remains set', async () => {
    render(<App />)

    act(() => { dispatchInit() })
    await waitFor(() => expect(screen.getByTestId('kanban-board')).toBeInTheDocument())

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'featureContent',
            featureId: 'feat-1',
            content: '# Feature 1',
            frontmatter: FRONTMATTER,
          },
        })
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('feature-editor')).toBeInTheDocument()
    })
  })
})

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
