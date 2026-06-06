/**
 * Stub fixtures — stand in for real adapter output until the MCP track lands.
 * They let the Board and PA build against realistic data on day one.
 */
import type { WorkItem, Session, WorkItemType, NormStatus, Priority } from './contract'

function wi(
  id: string,
  framework: string,
  type: WorkItemType,
  title: string,
  status: NormStatus,
  priority: Priority | null,
  dependsOn: string[],
  children: string[] = []
): WorkItem {
  return {
    id,
    source: { framework, path: `${framework}://${id}` },
    type,
    title,
    status,
    priority,
    parent: null,
    children,
    dependsOn,
    labels: [],
    estimate: null,
    acceptanceCriteria: [],
    bodyRef: `body:${id}`
  }
}

export const FIXTURE_WORK_ITEMS: WorkItem[] = [
  wi('native:setup-board', 'native', 'feature', 'Set up the board', 'done', 'high', []),
  wi('native:dependency-graph', 'native', 'feature', 'Dependency graph engine', 'done', 'high', []),
  wi('native:ready-lane-ui', 'native', 'story', 'Ready lane UI', 'todo', 'high', ['native:dependency-graph']),
  wi('native:live-arrows', 'native', 'story', 'Live dependency arrows', 'backlog', 'medium', ['native:ready-lane-ui']),
  wi('bmad:epic-1.story-2', 'bmad', 'story', 'Export board as CSV', 'todo', 'low', []),
  wi('gh:#42', 'github', 'task', 'Fix drag flicker', 'in-progress', 'medium', [])
]

export const FIXTURE_SESSIONS: Session[] = [
  {
    id: 'd75cfc06-19f0-4bd6-889c-9aff5f24be72',
    project: 'kanban-vscode-extension',
    status: 'active',
    lastActivity: 'Edit "ReadyLane.tsx"',
    gitBranch: 'story/native-ready-lane-ui',
    worktree: '.worktrees/story-native-ready-lane-ui',
    model: 'claude-opus-4-8',
    tokens: 48211,
    workItemId: 'native:ready-lane-ui'
  },
  {
    id: '9b5c530d-adbe-41cd-9d76-8456777b8323',
    project: 'kanban-vscode-extension',
    status: 'idle',
    lastActivity: 'Bash "pnpm test"',
    gitBranch: 'main',
    worktree: null,
    model: 'claude-sonnet-4-6',
    tokens: 12044,
    workItemId: 'gh:#42'
  }
]
