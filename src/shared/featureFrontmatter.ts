import * as path from 'path'
import type { Feature, FeatureStatus, Priority } from './types'

// Fields handled explicitly by parseFeatureFile — excluded from _extraFrontmatter
const KNOWN_KEYS = new Set([
  'id', 'status', 'priority', 'assignee', 'epic', 'dueDate',
  'created', 'modified', 'completedAt', 'completed',
  'labels', 'order', 'workspace', 'worktree'
])

export function parseFeatureFile(content: string, filePath: string): Feature | null {
  content = content.replace(/\r\n/g, '\n')
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!frontmatterMatch) return null

  const frontmatter = frontmatterMatch[1]
  const body = frontmatterMatch[2] || ''

  const getValue = (key: string): string => {
    const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))
    if (!match) return ''
    const value = match[1].trim().replace(/^["']|["']$/g, '')
    return value === 'null' ? '' : value
  }

  const getArrayValue = (key: string): string[] => {
    const match = frontmatter.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, 'm'))
    if (!match) return []
    return match[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  }

  // Capture any frontmatter fields not in the feature schema for lossless round-trips
  const extraEntries = [...frontmatter.matchAll(/^(\w+):\s*(.*)$/gm)]
    .filter(([, key]) => !KNOWN_KEYS.has(key))
  const _extraFrontmatter: Record<string, string> = {}
  for (const [, key, rawVal] of extraEntries) {
    _extraFrontmatter[key] = rawVal.trim()
  }

  return {
    id: getValue('id') || path.basename(filePath, '.md'),
    status: (getValue('status') as FeatureStatus) || 'backlog',
    priority: (getValue('priority') as Priority) || 'medium',
    assignee: getValue('assignee') || null,
    epic: getValue('epic') || null,
    dueDate: getValue('dueDate') || null,
    created: getValue('created') || new Date().toISOString(),
    modified: getValue('modified') || new Date().toISOString(),
    completedAt: getValue('completedAt') || getValue('completed') || null,
    labels: getArrayValue('labels'),
    order: getValue('order') || 'a0',
    workspace: getValue('workspace') || getValue('worktree') || null,
    content: body.trim(),
    filePath,
    ...(extraEntries.length > 0 ? { _extraFrontmatter } : {})
  }
}

export function serializeFeature(feature: Feature): string {
  const frontmatter = [
    '---',
    `id: "${feature.id}"`,
    `status: "${feature.status}"`,
    `priority: "${feature.priority}"`,
    `assignee: ${feature.assignee ? `"${feature.assignee}"` : 'null'}`,
    `epic: ${feature.epic ? `"${feature.epic}"` : 'null'}`,
    `dueDate: ${feature.dueDate ? `"${feature.dueDate}"` : 'null'}`,
    `created: "${feature.created}"`,
    `modified: "${feature.modified}"`,
    `completedAt: ${feature.completedAt ? `"${feature.completedAt}"` : 'null'}`,
    `labels: [${feature.labels.map(l => `"${l}"`).join(', ')}]`,
    `order: "${feature.order}"`,
    ...(feature.workspace !== null && feature.workspace !== undefined ? [`workspace: "${feature.workspace}"`] : []),
    ...(feature._extraFrontmatter
      ? Object.entries(feature._extraFrontmatter).map(([k, v]) => `${k}: ${v}`)
      : []),
    '---',
    ''
  ].join('\n')

  return frontmatter + feature.content
}
