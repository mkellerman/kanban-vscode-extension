// Kanban types

export type Priority = 'critical' | 'high' | 'medium' | 'low'
export type FeatureStatus = 'backlog' | 'todo' | 'in-progress' | 'review' | 'done'

// AI agent types
export type AIAgent = 'claude' | 'codex' | 'opencode' | 'copilot'
export type AIPermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'

export interface Feature {
  id: string
  status: FeatureStatus
  priority: Priority
  assignee: string | null
  epic: string | null
  dueDate: string | null
  created: string
  modified: string
  completedAt: string | null
  labels: string[]
  /** Feature IDs that must complete before this one can start. Empty when absent. */
  dependsOn: string[]
  order: string
  content: string
  filePath: string
  /** Per-task status overrides for Superpowers plans (0-based taskIndex → status). */
  taskStatuses?: Record<number, FeatureStatus>
  /** Original status string when the file uses a non-standard value (e.g. "paused"). */
  customStatus?: string
}

// Parse title from the first # heading in markdown content, falling back to the first line
export function getTitleFromContent(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  if (match) return match[1].trim()
  const firstLine = content.split('\n').map(l => l.trim()).find(l => l.length > 0)
  return firstLine || 'Untitled'
}

export interface PlanTask {
  id: string
  title: string
  status: FeatureStatus
  parentId: string
  checkedSteps: number
  totalSteps: number
  taskIndex: number
}

export interface PlanSection {
  type: 'description' | 'task'
  title: string      // "Description" | full heading text e.g. "Task 1: typeBadge helper"
  content: string    // raw markdown body, trimmed
  taskIndex?: number // 0-based index among task sections
}

export function parseSuperpowersTasks(
  content: string,
  parentId: string,
  taskStatuses?: Record<number, FeatureStatus>
): PlanTask[] {
  const tasks: PlanTask[] = []
  const taskHeadingRe = /^#+\s+Task\s+\d+[:.]\s+(.+)$/gm
  const matches = [...content.matchAll(taskHeadingRe)]
  const validStatuses = new Set<string>(['backlog', 'todo', 'in-progress', 'review', 'done'])
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const title = match[1].trim().replace(/`/g, '')
    const sectionStart = (match.index ?? 0) + match[0].length
    const sectionEnd = i + 1 < matches.length ? (matches[i + 1].index ?? content.length) : content.length
    const section = content.slice(sectionStart, sectionEnd)
    const checked = (section.match(/^- \[x\]/gim) ?? []).length
    const unchecked = (section.match(/^- \[ \]/gm) ?? []).length
    const total = checked + unchecked
    // Priority: sprintPlanning YAML > inline HTML comment (legacy) > checkbox-derived
    let status: FeatureStatus
    if (taskStatuses?.[i] !== undefined) {
      status = taskStatuses[i]
    } else {
      const explicitMatch = section.match(/<!--\s*status:\s*([\w-]+)\s*-->/i)
      const explicit = explicitMatch?.[1]
      status = (explicit && validStatuses.has(explicit))
        ? explicit as FeatureStatus
        : total === 0 || checked === 0 ? 'todo' : checked >= total ? 'done' : 'in-progress'
    }
    tasks.push({ id: `${parentId}.t${i}`, title, status, parentId, checkedSteps: checked, totalSteps: total, taskIndex: i })
  }
  return tasks
}

export function formatStatusLabel(status: FeatureStatus): string {
  switch (status) {
    case 'backlog':     return 'backlog'
    case 'todo':        return 'todo'
    case 'in-progress': return 'in progress'
    case 'review':      return 'review'
    case 'done':        return 'done'
  }
}

export type FilenamePattern = 'name-date' | 'date-name' | 'name-datetime' | 'datetime-name'

// Generate a filename-safe slug from a title
export function generateFeatureFilename(
  title: string,
  pattern: FilenamePattern = 'name-date',
  date: Date = new Date()
): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, '') // Trim hyphens from start/end
    .slice(0, 50) // Limit length

  const safeSlug = slug || 'feature'
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const timeStr = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`

  switch (pattern) {
    case 'date-name':     return `${dateStr}-${safeSlug}`
    case 'name-datetime': return `${safeSlug}-${dateStr}-${timeStr}`
    case 'datetime-name': return `${dateStr}-${timeStr}-${safeSlug}`
    case 'name-date':
    default:              return `${safeSlug}-${dateStr}`
  }
}

export interface KanbanColumn {
  id: string
  name: string
  color: string
}

export const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', name: 'Backlog', color: '#6b7280' },
  { id: 'todo', name: 'To Do', color: '#3b82f6' },
  { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
  { id: 'review', name: 'Review', color: '#8b5cf6' },
  { id: 'done', name: 'Done', color: '#22c55e' }
]

export interface CardDisplaySettings {
  showPriorityBadges: boolean
  showAssignee: boolean
  showDueDate: boolean
  showLabels: boolean
  showEpic: boolean
  showBuildWithAI: boolean
  showFileName: boolean
  compactMode: boolean
  markdownEditorMode: boolean
  hideScrollbar: boolean
  planLayoutFlat: boolean
  defaultPriority: Priority
  defaultStatus: FeatureStatus
}

// Messages between extension and webview
export type BoardViewMode = 'standard' | 'epic' | 'sequence'

/** Stable id for the "no epic" swim lane (persisted collapse state). */
export const NO_EPIC_LANE_ID = '__no_epic__'

export function epicLaneId(epic: string | null | undefined): string {
  const t = epic?.trim()
  return t ? t : NO_EPIC_LANE_ID
}

export type ExtensionMessage =
  | { type: 'init'; features: Feature[]; columns: KanbanColumn[]; settings: CardDisplaySettings; collapsedColumns: string[]; boardViewMode: BoardViewMode; collapsedEpics: string[]; locale: string; translations: Record<string, string> }
  | { type: 'featuresUpdated'; features: Feature[] }
  | { type: 'triggerCreateDialog' }
  | { type: 'featureContent'; featureId: string; content: string; frontmatter: FeatureFrontmatter }
  | { type: 'featurePlanContent'; feature: Feature; sections: PlanSection[]; focusTaskIndex?: number }

// Frontmatter for editing
export interface FeatureFrontmatter {
  id: string
  status: FeatureStatus
  priority: Priority
  assignee: string | null
  epic: string | null
  dueDate: string | null
  created: string
  modified: string
  completedAt: string | null
  labels: string[]
  /** Feature IDs that must complete before this one can start. Empty when absent. */
  dependsOn: string[]
  order: string
}

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'createFeature'; data: { status: FeatureStatus; priority: Priority; content: string; assignee: string | null; epic: string | null; dueDate: string | null; labels: string[] } }
  | { type: 'moveFeature'; featureId: string; newStatus: string; newOrder: number }
  | { type: 'deleteFeature'; featureId: string }
  | { type: 'updateFeature'; featureId: string; updates: Partial<Feature> }
  | { type: 'openFeature'; featureId: string; focusTaskIndex?: number }
  | { type: 'saveFeaturePlanContent'; featureId: string; sections: PlanSection[] }
  | { type: 'saveFeatureContent'; featureId: string; content: string; frontmatter: FeatureFrontmatter }
  | { type: 'closeFeature' }
  | { type: 'openFile'; featureId: string }
  | { type: 'openSettings' }
  | { type: 'toggleColumnCollapsed'; columnId: string }
  | { type: 'setBoardViewMode'; mode: BoardViewMode }
  | { type: 'toggleEpicCollapsed'; epicKey: string }
  | { type: 'moveAllCards'; sourceColumnId: string; targetColumnId: string; epicLane?: string | null }
  | { type: 'archiveAllCards'; sourceColumnId: string }
  | { type: 'renameLabel'; oldName: string; newName: string }
  | { type: 'deleteLabel'; labelName: string }
  | { type: 'moveTask'; featureId: string; taskIndex: number; newStatus: string }
