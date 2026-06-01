// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import type { Feature, FeatureStatus } from '../../../src/shared/types'
import { SequenceView } from '../../../src/webview/components/SequenceView'

function f(id: string, opts: Partial<Feature> = {}): Feature {
  return {
    id, status: 'todo', priority: 'medium',
    assignee: null, epic: null, dueDate: null,
    created: '', modified: '', completedAt: null,
    labels: [], dependsOn: [], order: 'a0',
    content: `# ${id}`, filePath: `/tmp/${id}.md`,
    ...opts,
  }
}

describe('SequenceView — rendering', () => {
  it('renders one row per root and indents children', () => {
    const features: Feature[] = [
      f('A', { priority: 'critical' }),
      f('B', { priority: 'high', dependsOn: ['A'] }),
      f('C', { priority: 'high' }),
    ]
    render(
      <SequenceView
        features={features}
        visibleStatuses={new Set<FeatureStatus>(['todo', 'in-progress', 'review'])}
        collapsedRoots={new Set<string>()}
        onToggleStatus={() => {}}
        onToggleCollapsed={() => {}}
        onOpenFeature={() => {}}
      />
    )
    // Both roots and the child render
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
    // Rank numbers appear on roots only
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.queryByText('3')).not.toBeInTheDocument()
  })

  it('hides empty state when no features match the filter', () => {
    render(
      <SequenceView
        features={[f('A', { status: 'backlog' })]}
        visibleStatuses={new Set<FeatureStatus>(['todo'])}
        collapsedRoots={new Set<string>()}
        onToggleStatus={() => {}}
        onToggleCollapsed={() => {}}
        onOpenFeature={() => {}}
      />
    )
    expect(screen.getByText(/no features match/i)).toBeInTheDocument()
  })

  it('renders a status chip for each FeatureStatus value', () => {
    render(
      <SequenceView
        features={[]}
        visibleStatuses={new Set<FeatureStatus>(['todo'])}
        collapsedRoots={new Set<string>()}
        onToggleStatus={() => {}}
        onToggleCollapsed={() => {}}
        onOpenFeature={() => {}}
      />
    )
    expect(screen.getByRole('button', { name: /todo/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /in-progress/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /backlog/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument()
  })
})

describe('SequenceView — collapse interaction', () => {
  it('calls onToggleCollapsed with the root id when the chevron is clicked', () => {
    const onToggleCollapsed = vi.fn()
    render(
      <SequenceView
        features={[f('A', { priority: 'critical' }), f('B', { dependsOn: ['A'] })]}
        visibleStatuses={new Set<FeatureStatus>(['todo', 'in-progress', 'review'])}
        collapsedRoots={new Set<string>()}
        onToggleStatus={() => {}}
        onToggleCollapsed={onToggleCollapsed}
        onOpenFeature={() => {}}
      />
    )
    const chevs = screen.getAllByText('▾')
    fireEvent.click(chevs[0])
    expect(onToggleCollapsed).toHaveBeenCalledWith('A')
  })

  it('does not open the feature when the chevron is clicked', () => {
    const onOpenFeature = vi.fn()
    render(
      <SequenceView
        features={[f('A', { priority: 'critical' }), f('B', { dependsOn: ['A'] })]}
        visibleStatuses={new Set<FeatureStatus>(['todo', 'in-progress', 'review'])}
        collapsedRoots={new Set<string>()}
        onToggleStatus={() => {}}
        onToggleCollapsed={() => {}}
        onOpenFeature={onOpenFeature}
      />
    )
    const chevs = screen.getAllByText('▾')
    fireEvent.click(chevs[0])
    expect(onOpenFeature).not.toHaveBeenCalled()
  })

  it('hides children when the root is in collapsedRoots and flips chevron to ▸', () => {
    render(
      <SequenceView
        features={[f('A', { priority: 'critical' }), f('B', { dependsOn: ['A'] })]}
        visibleStatuses={new Set<FeatureStatus>(['todo', 'in-progress', 'review'])}
        collapsedRoots={new Set<string>(['A'])}
        onToggleStatus={() => {}}
        onToggleCollapsed={() => {}}
        onOpenFeature={() => {}}
      />
    )
    expect(screen.getByText('▸')).toBeInTheDocument()
    expect(screen.queryByText('B')).not.toBeInTheDocument()
  })
})
