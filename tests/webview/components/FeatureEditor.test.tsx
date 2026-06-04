// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FeatureEditor } from '../../../src/webview/components/FeatureEditor'
import { useStore } from '../../../src/webview/store'
import type { CardDisplaySettings, FeatureFrontmatter } from '../../../src/shared/types'

// ---------------------------------------------------------------------------
// Mock TipTap (doesn't work in jsdom)
// ---------------------------------------------------------------------------
vi.mock('@tiptap/react', () => ({
  useEditor: () => null,
  EditorContent: () => null
}))
vi.mock('@tiptap/starter-kit', () => ({ default: {} }))
vi.mock('@tiptap/extension-placeholder', () => ({ default: { configure: () => ({}) } }))
vi.mock('tiptap-markdown', () => ({ Markdown: { configure: () => ({}) } }))

// ---------------------------------------------------------------------------
// Mock vscode postMessage
// ---------------------------------------------------------------------------
const { mockPostMessage } = vi.hoisted(() => ({ mockPostMessage: vi.fn() }))
vi.mock('../../../src/webview/vscodeApi', () => ({ vscode: { postMessage: mockPostMessage } }))

// ---------------------------------------------------------------------------
// Store reset
// ---------------------------------------------------------------------------
const initialState = useStore.getState()
beforeEach(() => { useStore.setState(initialState, true) })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const defaultSettings: CardDisplaySettings = {
  showPriorityBadges: true,
  showAssignee: true,
  showDueDate: true,
  showLabels: true,
  showEpic: true,
  showBuildWithAI: true,
  showFileName: false,
  compactMode: false,
  markdownEditorMode: false,
  hideScrollbar: false,
  defaultPriority: 'medium',
  defaultStatus: 'backlog'
}

function setSettings(overrides: Partial<CardDisplaySettings> = {}) {
  useStore.setState({ cardSettings: { ...defaultSettings, ...overrides } })
}

function makeFrontmatter(overrides: Partial<FeatureFrontmatter> = {}): FeatureFrontmatter {
  return {
    id: 'feat-1',
    status: 'in-progress',
    priority: 'medium',
    assignee: null,
    epic: null,
    dueDate: null,
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    labels: [],
    order: 'a0',
    workspace: null,
    ...overrides
  }
}

const noOp = () => {}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('FeatureEditor — workspace indicator', () => {
  it('shows ⎇ indicator when workspace is a branch name', () => {
    setSettings()
    render(
      <FeatureEditor
        featureId="feat-1"
        content="# Test"
        frontmatter={makeFrontmatter({ workspace: 'feat/my-story' })}
        onSave={noOp}
        onClose={noOp}
        onDelete={noOp}
        onOpenFile={noOp}
        onStartWithAI={noOp}
      />
    )
    expect(screen.getByText('⎇ feat/my-story')).toBeInTheDocument()
  })

  it('shows ⎇ indicator with basename when workspace is a worktree path', () => {
    setSettings()
    render(
      <FeatureEditor
        featureId="feat-1"
        content="# Test"
        frontmatter={makeFrontmatter({ workspace: '/worktrees/my-story' })}
        onSave={noOp}
        onClose={noOp}
        onDelete={noOp}
        onOpenFile={noOp}
        onStartWithAI={noOp}
      />
    )
    expect(screen.getByText('⎇ my-story')).toBeInTheDocument()
  })

  it('shows no ⎇ indicator when workspace is null', () => {
    setSettings()
    render(
      <FeatureEditor
        featureId="feat-1"
        content="# Test"
        frontmatter={makeFrontmatter({ workspace: null })}
        onSave={noOp}
        onClose={noOp}
        onDelete={noOp}
        onOpenFile={noOp}
        onStartWithAI={noOp}
      />
    )
    expect(screen.queryByText(/⎇/)).not.toBeInTheDocument()
  })
})
