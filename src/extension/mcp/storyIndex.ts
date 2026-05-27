import fs from 'node:fs/promises'
import path from 'node:path'
import { getTitleFromContent, type Feature } from '../../shared/types'
import type { FrameworkAdapter } from '../frameworks/FrameworkAdapter'
import { makeFeatureId } from '../../shared/frameworks/types'

export interface StorySummary {
  id: string
  title: string
  status: Feature['status']
  priority: Feature['priority']
  labels: string[]
  assignee: string | null
  path: string
  summary: string
}

export interface StoryScanSource {
  adapter: FrameworkAdapter
  filePath: string
  feature: Feature
}

function normalizeFilePath(filePath: string): string {
  return path.resolve(filePath)
}

function sortAdapters(adapters: FrameworkAdapter[]): FrameworkAdapter[] {
  return [...adapters].sort((a, b) => a.id.localeCompare(b.id))
}

function sortPaths(paths: string[]): string[] {
  return [...paths].sort((a, b) => normalizeFilePath(a).localeCompare(normalizeFilePath(b)))
}

async function readFeatureFromFile(adapter: FrameworkAdapter, filePath: string): Promise<StoryScanSource | null> {
  const content = await fs.readFile(filePath, 'utf8')
  const feature = adapter.parseFile(content, filePath)
  if (!feature) return null
  return { adapter, filePath, feature }
}

export async function scanStories(workspaceRoot: string, adapters: FrameworkAdapter[]): Promise<StoryScanSource[]> {
  const found: StoryScanSource[] = []

  for (const adapter of sortAdapters(adapters)) {
    const files = sortPaths(await adapter.getFiles(workspaceRoot))
    for (const filePath of files) {
      try {
        const source = await readFeatureFromFile(adapter, filePath)
        if (source) {
          found.push(source)
        }
      } catch {
        // Skip unreadable or unparseable files.
      }
    }
  }

  return found
}

export async function listStoriesForSelection(input: {
  workspaceRoot: string
  adapters: FrameworkAdapter[]
  status?: Feature['status']
  label?: string
  assignee?: string
  all?: boolean
}): Promise<StorySummary[]> {
  const stories = await scanStories(input.workspaceRoot, input.adapters)
  const filtered = stories.filter(({ feature }) => {
    if (!input.all) {
      if (input.status) {
        if (feature.status !== input.status) return false
      } else if (feature.status !== 'todo') {
        return false
      }
    }

    if (input.label && !feature.labels.includes(input.label)) return false
    if (input.assignee !== undefined && feature.assignee !== input.assignee) return false
    return true
  })

  return filtered.map(({ adapter, filePath, feature }) => {
    const title = getTitleFromContent(feature.content)
    return {
      id: makeFeatureId(adapter.id, feature.id),
      title,
      status: feature.status,
      priority: feature.priority,
      labels: [...feature.labels],
      assignee: feature.assignee,
      path: normalizeFilePath(filePath),
      summary: title
    }
  })
}
