import * as path from 'path'
import type { Feature, FeatureStatus, Priority } from '../types'

const KANBAN_KEYS = new Set([
  'id', 'status', 'priority', 'assignee', 'epic', 'dueDate',
  'created', 'modified', 'completedAt', 'labels', 'order'
])

const KANBAN_KEY_ORDER = [
  'id', 'status', 'priority', 'assignee', 'epic', 'dueDate',
  'created', 'modified', 'completedAt', 'labels', 'order'
] as const

function kanbanLine(feature: Feature, key: string): string {
  switch (key) {
    case 'id':          return `id: "${feature.id}"`
    case 'status':      return `status: "${feature.customStatus ?? feature.status}"`
    case 'priority':    return `priority: "${feature.priority}"`
    case 'assignee':    return `assignee: ${feature.assignee ? `"${feature.assignee}"` : 'null'}`
    case 'epic':        return `epic: ${feature.epic ? `"${feature.epic}"` : 'null'}`
    case 'dueDate':     return `dueDate: ${feature.dueDate ? `"${feature.dueDate}"` : 'null'}`
    case 'created':     return `created: "${feature.created}"`
    case 'modified':    return `modified: "${feature.modified}"`
    case 'completedAt': return `completedAt: ${feature.completedAt ? `"${feature.completedAt}"` : 'null'}`
    case 'labels':      return `labels: [${feature.labels.map(l => `"${l}"`).join(', ')}]`
    case 'order':       return `order: "${feature.order}"`
    default:            return ''
  }
}

function buildNewFrontmatter(feature: Feature): string {
  return ['---', ...KANBAN_KEY_ORDER.map(k => kanbanLine(feature, k)), '---', ''].join('\n')
}

// ── Status alias resolution ────────────────────────────────────────────────

const STATUS_ALIASES: Array<[FeatureStatus, string[]]> = [
  ['backlog',     ['backlog', 'icebox', 'someday', 'future']],
  ['todo',        ['todo', 'to-do', 'to do', 'planned', 'ready', 'open', 'queued']],
  ['in-progress', ['in-progress', 'in progress', 'inprogress', 'doing', 'wip', 'active', 'started', 'ongoing']],
  ['review',      ['review', 'in-review', 'in review', 'reviewing', 'testing', 'qa', 'pr']],
  ['done',        ['done', 'completed', 'complete', 'finished', 'closed', 'resolved', 'shipped', 'released', 'merged']],
]

const STATUS_LOOKUP = new Map<string, FeatureStatus>(
  STATUS_ALIASES.flatMap(([status, aliases]) => aliases.map(a => [a, status]))
)

/** Resolve a raw status string to a known FeatureStatus, or return null if unrecognised. */
function resolveStatus(raw: string): FeatureStatus | null {
  return STATUS_LOOKUP.get(raw.toLowerCase()) ?? null
}

// ── sprintPlanning task-status helpers ─────────────────────────────────────

const VALID_STATUSES = new Set(['backlog', 'todo', 'in-progress', 'review', 'done'])

/** Extract per-task statuses from the sprintPlanning.tasks[] YAML block. */
function parseSprintPlanningTaskStatuses(fm: string): Record<number, FeatureStatus> {
  const statuses: Record<number, FeatureStatus> = {}
  const lines = fm.split('\n')
  let inSP = false
  let inTasks = false
  let currentId: number | null = null

  for (const line of lines) {
    if (/^sprintPlanning:/.test(line)) { inSP = true; continue }
    if (inSP && /^\S/.test(line) && line.trim() !== '') break
    if (!inSP) continue
    if (/^\s+tasks:\s*$/.test(line)) { inTasks = true; continue }
    if (!inTasks) continue

    const idMatch = line.match(/^\s+-\s+id:\s*(\d+)/)
    if (idMatch) { currentId = parseInt(idMatch[1], 10); continue }

    if (currentId !== null) {
      const statusMatch = line.match(/^\s+status:\s*["']?([\w-]+)["']?\s*$/)
      if (statusMatch && VALID_STATUSES.has(statusMatch[1])) {
        statuses[currentId - 1] = statusMatch[1] as FeatureStatus  // 1-based id → 0-based index
      }
    }
  }
  return statuses
}

/**
 * Write taskStatuses into the sprintPlanning.tasks[] block.
 * Updates existing status lines, appends new ones for tasks with no entry,
 * and adds the entire sprintPlanning section if it doesn't exist.
 */
function applyTaskStatusesToFrontmatter(fm: string, taskStatuses: Record<number, FeatureStatus>): string {
  if (Object.keys(taskStatuses).length === 0) return fm

  const hasSP = fm.includes('sprintPlanning:')
  if (!hasSP) {
    // Prepend a minimal sprintPlanning block before the kanban keys
    const sortedIdxs = Object.keys(taskStatuses).map(Number).sort((a, b) => a - b)
    const spLines = [
      'sprintPlanning:',
      '  version: 1',
      '  taskStateSource: markdown-checkboxes',
      '  tasks:',
      ...sortedIdxs.flatMap(idx => [
        `    - id: ${idx + 1}`,
        `      status: "${taskStatuses[idx]}"`,
      ]),
    ]
    return spLines.join('\n') + '\n' + fm
  }

  const lines = fm.split('\n')
  const result: string[] = []
  let inSP = false
  let inTasks = false
  let currentId: number | null = null
  let taskIndent = '    '
  const written = new Set<number>()  // 0-based indices already written

  const flushPending = () => {
    if (currentId === null) return
    const idx = currentId - 1
    if (!written.has(idx) && taskStatuses[idx] !== undefined) {
      result.push(`${taskIndent}  status: "${taskStatuses[idx]}"`)
      written.add(idx)
    }
  }

  const appendMissing = () => {
    const missing = Object.keys(taskStatuses).map(Number)
      .filter(idx => !written.has(idx))
      .sort((a, b) => a - b)
    for (const idx of missing) {
      result.push(`${taskIndent}- id: ${idx + 1}`)
      result.push(`${taskIndent}  status: "${taskStatuses[idx]}"`)
      written.add(idx)
    }
  }

  for (const line of lines) {
    if (/^sprintPlanning:/.test(line)) {
      inSP = true
      result.push(line)
      continue
    }

    if (inSP && /^\S/.test(line) && line.trim() !== '') {
      // Leaving sprintPlanning block — flush any pending status and append missing entries
      flushPending()
      if (inTasks) appendMissing()
      inSP = false; inTasks = false; currentId = null
      result.push(line)
      continue
    }

    if (!inSP) { result.push(line); continue }

    if (/^\s+tasks:\s*$/.test(line)) {
      inTasks = true
      result.push(line)
      continue
    }

    if (!inTasks) { result.push(line); continue }

    const idMatch = line.match(/^(\s+)-\s+id:\s*(\d+)/)
    if (idMatch) {
      flushPending()
      taskIndent = idMatch[1]
      currentId = parseInt(idMatch[2], 10)
      result.push(line)
      continue
    }

    // Replace an existing status line within the current task
    if (currentId !== null && /^\s+status:/.test(line)) {
      const idx = currentId - 1
      if (taskStatuses[idx] !== undefined) {
        const indent = line.match(/^(\s+)/)?.[1] ?? `${taskIndent}  `
        result.push(`${indent}status: "${taskStatuses[idx]}"`)
        written.add(idx)
        continue
      }
    }

    result.push(line)
  }

  // End of file — flush last task and append any tasks not in the existing YAML
  flushPending()
  if (inTasks) appendMissing()

  return result.join('\n')
}

// ── Public API ──────────────────────────────────────────────────────────────

export function parseSuperpowersFile(content: string, filePath: string): Feature {
  content = content.replace(/\r\n/g, '\n')
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const defaultId = path.basename(filePath, '.md')

  if (!frontmatterMatch) {
    return {
      id: defaultId,
      status: 'backlog',
      priority: 'medium',
      assignee: null,
      epic: null,
      dueDate: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      completedAt: null,
      labels: [],
      dependsOn: [],
      order: 'a0',
      content: content.trim(),
      filePath
    }
  }

  const fm = frontmatterMatch[1]
  const body = frontmatterMatch[2] || ''

  const getValue = (key: string): string => {
    const match = fm.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))
    if (!match) return ''
    const value = match[1].trim().replace(/^["']|["']$/g, '')
    return value === 'null' ? '' : value
  }

  const getArrayValue = (key: string): string[] => {
    const match = fm.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, 'm'))
    if (!match) return []
    return match[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  }

  const taskStatuses = parseSprintPlanningTaskStatuses(fm)
  const rawStatus = getValue('status')
  const resolvedStatus = rawStatus ? resolveStatus(rawStatus) : null

  return {
    id: getValue('id') || defaultId,
    status: resolvedStatus ?? 'backlog',
    ...(rawStatus && !resolvedStatus ? { customStatus: rawStatus } : {}),
    priority: (getValue('priority') as Priority) || 'medium',
    assignee: getValue('assignee') || null,
    epic: getValue('epic') || null,
    dueDate: getValue('dueDate') || null,
    created: getValue('created') || new Date().toISOString(),
    modified: getValue('modified') || new Date().toISOString(),
    completedAt: getValue('completedAt') || null,
    labels: getArrayValue('labels'),
    dependsOn: getArrayValue('dependsOn'),
    order: getValue('order') || 'a0',
    content: body.trim(),
    filePath,
    ...(Object.keys(taskStatuses).length > 0 ? { taskStatuses } : {})
  }
}

export function serializeSuperpowersFeature(feature: Feature, originalContent: string): string {
  const normalized = originalContent.replace(/\r\n/g, '\n')
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)

  if (!frontmatterMatch) {
    const fm = applyTaskStatusesToFrontmatter(
      KANBAN_KEY_ORDER.map(k => kanbanLine(feature, k)).join('\n'),
      feature.taskStatuses ?? {}
    )
    return `---\n${fm}\n---\n${normalized}`
  }

  const existingFm = frontmatterMatch[1]
  const body = frontmatterMatch[2] || ''
  const writtenKeys = new Set<string>()

  const updatedLines = existingFm.split('\n').map(line => {
    const keyMatch = line.match(/^(\w+):/)
    if (!keyMatch) return line
    const key = keyMatch[1]
    if (!KANBAN_KEYS.has(key)) return line
    writtenKeys.add(key)
    return kanbanLine(feature, key)
  })

  for (const key of KANBAN_KEY_ORDER) {
    if (!writtenKeys.has(key)) {
      updatedLines.push(kanbanLine(feature, key))
    }
  }

  const fm = applyTaskStatusesToFrontmatter(updatedLines.join('\n'), feature.taskStatuses ?? {})
  return `---\n${fm}\n---\n${body}`
}
