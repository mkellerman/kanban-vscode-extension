import * as path from 'path'
import { parse, Document, YAMLMap, YAMLSeq, Scalar, Pair } from 'yaml'
import type { Feature, FeatureStatus, Priority } from './types'

/**
 * Parses a markdown file with YAML frontmatter into a Feature object.
 * Extracts metadata from the frontmatter block and markdown content.
 * If no id field is present, uses the filename (without .md extension) as the id.
 * @param content The full file content (frontmatter + markdown body)
 * @param filePath The file path, used for id fallback and stored in Feature
 * @returns Feature object or null if file lacks frontmatter
 */
export function parseFeatureFile(content: string, filePath: string): Feature | null {
  content = content.replace(/\r\n/g, '\n')
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!frontmatterMatch) return null

  const frontmatter = frontmatterMatch[1]
  const body = frontmatterMatch[2] || ''

  let parsed: Record<string, unknown>
  try {
    const raw = parse(frontmatter)
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
    parsed = raw as Record<string, unknown>
  } catch {
    return null
  }

  const getString = (key: string): string | null => {
    const val = parsed[key]
    if (val === null || val === undefined || val === '') return null
    return String(val)
  }

  return {
    id: getString('id') || path.basename(filePath, '.md'),
    status: (getString('status') as FeatureStatus) || 'backlog',
    priority: (getString('priority') as Priority) || 'medium',
    assignee: getString('assignee'),
    epic: getString('epic'),
    dueDate: getString('dueDate'),
    created: getString('created') || new Date().toISOString(),
    modified: getString('modified') || new Date().toISOString(),
    completedAt: getString('completedAt'),
    labels: Array.isArray(parsed['labels'])
      ? (parsed['labels'] as unknown[])
          .filter((item): item is string | number | boolean => item !== null && item !== undefined && item !== '')
          .map(String)
      : [],
    order: getString('order') || 'a0',
    content: body.trim(),
    filePath
  }
}

/**
 * Serializes a Feature object into a markdown file with YAML frontmatter.
 * Converts the Feature's metadata into YAML frontmatter followed by the content body.
 * @param feature The Feature object to serialize
 * @returns The complete file content (frontmatter + markdown body)
 */
export function serializeFeature(feature: Feature): string {
  const frontmatterObj: Record<string, unknown> = {
    id: feature.id,
    status: feature.status,
    priority: feature.priority,
    assignee: feature.assignee,
    epic: feature.epic,
    dueDate: feature.dueDate,
    created: feature.created,
    modified: feature.modified,
    completedAt: feature.completedAt,
    labels: feature.labels,
    order: feature.order,
  }

  const doc = new Document()
  const map = new YAMLMap()

  for (const [key, value] of Object.entries(frontmatterObj)) {
    const k = new Scalar(key)
    k.type = 'PLAIN'

    let v: Scalar | YAMLSeq
    if (value === null || value === undefined) {
      v = new Scalar(null)
    } else if (Array.isArray(value)) {
      const seq = new YAMLSeq()
      seq.flow = true
      for (const item of value as string[]) {
        const s = new Scalar(item)
        s.type = 'QUOTE_DOUBLE'
        seq.add(s)
      }
      v = seq
    } else {
      v = new Scalar(value as string)
      v.type = 'QUOTE_DOUBLE'
    }

    map.add(new Pair(k, v))
  }

  doc.contents = map
  const yamlStr = doc.toString({ flowCollectionPadding: false })

  return `---\n${yamlStr}---\n${feature.content}`
}
