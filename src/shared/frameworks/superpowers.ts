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
    case 'status':      return `status: "${feature.status}"`
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

  return {
    id: getValue('id') || defaultId,
    status: (getValue('status') as FeatureStatus) || 'backlog',
    priority: (getValue('priority') as Priority) || 'medium',
    assignee: getValue('assignee') || null,
    epic: getValue('epic') || null,
    dueDate: getValue('dueDate') || null,
    created: getValue('created') || new Date().toISOString(),
    modified: getValue('modified') || new Date().toISOString(),
    completedAt: getValue('completedAt') || null,
    labels: getArrayValue('labels'),
    order: getValue('order') || 'a0',
    content: body.trim(),
    filePath
  }
}

export function serializeSuperpowersFeature(feature: Feature, originalContent: string): string {
  const normalized = originalContent.replace(/\r\n/g, '\n')
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)

  if (!frontmatterMatch) {
    return buildNewFrontmatter(feature) + normalized
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

  return `---\n${updatedLines.join('\n')}\n---\n${body}`
}
