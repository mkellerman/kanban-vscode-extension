// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toolbar } from '../../../src/webview/components/Toolbar'
import { useStore } from '../../../src/webview/store'
import type { Feature, CardDisplaySettings } from '../../../src/shared/types'

const { mockPostMessage } = vi.hoisted(() => ({ mockPostMessage: vi.fn() }))

vi.mock('../../../src/webview/vscodeApi', () => ({
  vscode: { postMessage: mockPostMessage }
}))

const initialState = useStore.getState()

beforeEach(() => {
  useStore.setState(initialState, true)
  mockPostMessage.mockClear()
})

const CARD_SETTINGS_EPIC_ONLY: CardDisplaySettings = {
  showPriorityBadges: false,
  showAssignee: false,
  showDueDate: false,
  showLabels: false,
  showEpic: true,
  showBuildWithAI: false,
  showFileName: false,
  compactMode: false,
  markdownEditorMode: false,
  hideScrollbar: false,
  defaultPriority: 'medium',
  defaultStatus: 'backlog',
}

function setupToolbar(cardSettings: CardDisplaySettings = CARD_SETTINGS_EPIC_ONLY) {
  useStore.setState({ cardSettings })
  const user = userEvent.setup()
  render(
    <Toolbar
      onOpenSettings={vi.fn()}
      boardViewMode="standard"
      onBoardViewModeChange={vi.fn()}
    />
  )
  return { user }
}

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
    workspace: null,
    content: `# ${id}`,
    filePath: `/workspace/${id}.md`,
  }
}

describe('Toolbar — epic filter', () => {
  it('renders the epic filter select when cardSettings.showEpic is true', () => {
    setupToolbar()
    expect(screen.getByDisplayValue('All Epics')).toBeInTheDocument()
  })

  it('does not render the epic filter when cardSettings.showEpic is false', () => {
    setupToolbar({ ...CARD_SETTINGS_EPIC_ONLY, showEpic: false })
    expect(screen.queryByDisplayValue('All Epics')).not.toBeInTheDocument()
  })

  it('includes "No Epic" option', () => {
    setupToolbar()
    expect(screen.getByRole('option', { name: 'No Epic' })).toBeInTheDocument()
  })

  it('lists named epics from the store', () => {
    useStore.setState({
      cardSettings: CARD_SETTINGS_EPIC_ONLY,
      features: [makeFeature('Alpha', 'f1'), makeFeature('Beta', 'f2')],
    })
    setupToolbar(CARD_SETTINGS_EPIC_ONLY)
    expect(screen.getByRole('option', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Beta' })).toBeInTheDocument()
  })

  it('calls setEpicFilter when the user changes the selection', async () => {
    useStore.setState({
      cardSettings: CARD_SETTINGS_EPIC_ONLY,
      features: [makeFeature('Gamma', 'f1')],
    })
    const { user } = setupToolbar(CARD_SETTINGS_EPIC_ONLY)
    await user.selectOptions(screen.getByDisplayValue('All Epics'), 'Gamma')
    expect(useStore.getState().epicFilter).toBe('Gamma')
  })

  it('renders only the two sentinel options when no features have epics', () => {
    setupToolbar()
    expect(screen.getByRole('option', { name: 'All Epics' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'No Epic' })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })
})
