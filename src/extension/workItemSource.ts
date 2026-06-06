/**
 * Board data source — adapts the Backlog MCP's normalized `WorkItem`s into the
 * webview's existing `Feature` card shape, so the board can render work from any
 * framework the MCP knows. Extension-host only (imports the MCP library, which
 * touches node:fs); never import this from the webview.
 */
import { listWorkItems, setBoardRoot, type WorkItem } from '@kanban/backlog-mcp'
import type { Feature, FeatureStatus, Priority } from '../shared/types'

const COLUMN_STATUS = new Set<FeatureStatus>(['backlog', 'todo', 'in-progress', 'review', 'done'])

/** Map the broader NormStatus onto the 5 board columns. */
function toFeatureStatus(status: string): FeatureStatus {
  if (COLUMN_STATUS.has(status as FeatureStatus)) return status as FeatureStatus
  if (status === 'blocked') return 'todo'
  if (status === 'cancelled') return 'done'
  return 'backlog'
}

/** WorkItem → the webview's Feature card shape (synthesizing Feature-only fields). */
export function toFeature(wi: WorkItem): Feature {
  const now = new Date().toISOString()
  return {
    id: wi.id,
    status: toFeatureStatus(wi.status),
    priority: (wi.priority ?? 'medium') as Priority,
    assignee: null,
    epic: wi.parent,
    dueDate: null,
    created: now,
    modified: now,
    completedAt: wi.status === 'done' ? now : null,
    labels: wi.labels,
    order: 'a0',
    workspace: null,
    content: `# ${wi.title}\n`, // title renders via getTitleFromContent
    filePath: wi.source.path,
    _extraFrontmatter: {
      source: wi.source.framework, // provenance chip (slice 2)
      dependsOn: wi.dependsOn.join(',') // dependency arrows (slice 2)
    }
  }
}

/** Load the current board as Features from the Backlog MCP (rooted at `root`, e.g. the workspace). */
export async function loadBoardFeatures(root?: string): Promise<Feature[]> {
  if (root) setBoardRoot(root)
  const items = await listWorkItems()
  return items.map(toFeature)
}
