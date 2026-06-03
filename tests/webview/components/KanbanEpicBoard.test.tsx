// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KanbanEpicBoard } from '../../../src/webview/components/KanbanEpicBoard'
import { useStore } from '../../../src/webview/store'
import type { Feature, KanbanColumn } from '../../../src/shared/types'

// Mock vscode API
const { mockPostMessage } = vi.hoisted(() => ({ mockPostMessage: vi.fn() }))
vi.mock('../../../src/webview/vscodeApi', () => ({
  vscode: { postMessage: mockPostMessage }
}))

// Mock KanbanBoard — each instance renders a sentinel so we can check which lanes appear
vi.mock('../../../src/webview/components/KanbanBoard', () => ({
  KanbanBoard: ({ epicFilter }: { epicFilter?: string | null }) => (
    <div data-testid={`kanban-board-lane-${epicFilter ?? '__null__'}`} />
  )
}))

const initialState = useStore.getState()

beforeEach(() => {
  useStore.setState(initialState, true)
  mockPostMessage.mockClear()
})

const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'todo', name: 'To Do', color: '#3b82f6' },
]

function makeFeature(epic: string | null, id: string): Feature {
  return {
    id,
    status: 'todo',
    priority: 'medium',
    assignee: null,
    epic,
    dueDate: null,
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    labels: [],
    order: 'a0',
    content: `# ${id}`,
    filePath: `/workspace/${id}.md`,
  }
}

function setup() {
  render(
    <KanbanEpicBoard
      onFeatureClick={vi.fn()}
      onAddFeature={vi.fn()}
      onMoveFeature={vi.fn()}
    />
  )
}

describe('KanbanEpicBoard — epic filter lane visibility', () => {
  beforeEach(() => {
    useStore.setState({
      columns: DEFAULT_COLUMNS,
      features: [
        makeFeature('Alpha', 'f1'),
        makeFeature('Beta',  'f2'),
        makeFeature(null,    'f3'),
      ],
    })
  })

  it('renders all lanes when epicFilter is "all"', () => {
    setup()
    expect(screen.getByTestId('kanban-board-lane-Alpha')).toBeInTheDocument()
    expect(screen.getByTestId('kanban-board-lane-Beta')).toBeInTheDocument()
    expect(screen.getByTestId('kanban-board-lane-__null__')).toBeInTheDocument()
  })

  it('renders only the matching named lane when a named epic filter is active', () => {
    useStore.setState({ epicFilter: 'Alpha' })
    setup()
    expect(screen.getByTestId('kanban-board-lane-Alpha')).toBeInTheDocument()
    expect(screen.queryByTestId('kanban-board-lane-Beta')).not.toBeInTheDocument()
    expect(screen.queryByTestId('kanban-board-lane-__null__')).not.toBeInTheDocument()
  })

  it('renders only the no-epic lane when epicFilter is "no-epic"', () => {
    useStore.setState({ epicFilter: 'no-epic' })
    setup()
    expect(screen.queryByTestId('kanban-board-lane-Alpha')).not.toBeInTheDocument()
    expect(screen.queryByTestId('kanban-board-lane-Beta')).not.toBeInTheDocument()
    expect(screen.getByTestId('kanban-board-lane-__null__')).toBeInTheDocument()
  })

  it('shows empty state when the filter matches no lanes', () => {
    useStore.setState({ epicFilter: 'Nonexistent' })
    setup()
    // All lane boards absent; the empty-state message appears instead
    expect(screen.queryByTestId(/kanban-board-lane/)).not.toBeInTheDocument()
  })
})
