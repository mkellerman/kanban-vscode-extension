import fs from 'node:fs/promises'
import path from 'node:path'
import { getTitleFromContent, type Feature } from '../../shared/types'
import type { FrameworkAdapter } from '../frameworks/FrameworkAdapter'
import { makeFeatureId, parseFeatureId, type FrameworkId } from '../../shared/frameworks/types'
import type { StorySummary } from './storyIndex'

export interface StoryProvenance {
  frameworkId: FrameworkId
  localId: string
  path: string
}

export interface StoryDetail extends StorySummary {
  body: string
  provenance: StoryProvenance
}

export interface ResolvedStorySource {
  adapter: FrameworkAdapter
  frameworkId: FrameworkId
  localId: string
  filePath: string
  feature: Feature
  rawContent: string
}

function normalizeFilePath(filePath: string): string {
  return path.resolve(filePath)
}

async function readFeatureSource(adapter: FrameworkAdapter, filePath: string): Promise<{ feature: Feature; rawContent: string } | null> {
  const rawContent = await fs.readFile(filePath, 'utf8')
  const feature = adapter.parseFile(rawContent, filePath)
  if (!feature) return null
  return { feature, rawContent }
}

async function findSourceById(workspaceRoot: string, adapters: FrameworkAdapter[], frameworkId: FrameworkId, localId: string): Promise<ResolvedStorySource> {
  const adapter = adapters.find((candidate) => candidate.id === frameworkId)
  if (!adapter) {
    throw new Error(`Unknown story framework: ${frameworkId}`)
  }

  const files = await adapter.getFiles(workspaceRoot)
  for (const filePath of files) {
    try {
      const source = await readFeatureSource(adapter, filePath)
      if (source?.feature.id === localId) {
        return {
          adapter,
          frameworkId,
          localId,
          filePath: normalizeFilePath(filePath),
          feature: source.feature,
          rawContent: source.rawContent
        }
      }
    } catch {
      // Skip unreadable files.
    }
  }

  throw new Error(`Story not found: ${frameworkId}:${localId}`)
}

async function findSourceByPath(workspaceRoot: string, adapters: FrameworkAdapter[], filePath: string): Promise<ResolvedStorySource> {
  const normalizedTarget = normalizeFilePath(filePath)

  for (const adapter of adapters) {
    const files = await adapter.getFiles(workspaceRoot)
    if (!files.map(normalizeFilePath).includes(normalizedTarget)) continue

    for (const candidatePath of files) {
      if (normalizeFilePath(candidatePath) !== normalizedTarget) continue

      try {
        const source = await readFeatureSource(adapter, candidatePath)
        if (source) {
          return {
            adapter,
            frameworkId: adapter.id,
            localId: source.feature.id,
            filePath: normalizedTarget,
            feature: source.feature,
            rawContent: source.rawContent
          }
        }
      } catch {
        break
      }
    }
  }

  throw new Error(`Story not found at path: ${filePath}`)
}

export async function resolveStorySource(input: {
  workspaceRoot: string
  adapters: FrameworkAdapter[]
  storyId?: string
  filePath?: string
}): Promise<ResolvedStorySource> {
  if ((input.storyId && input.filePath) || (!input.storyId && !input.filePath)) {
    throw new Error('Provide exactly one of storyId or filePath')
  }

  if (input.storyId) {
    const parsed = parseFeatureId(input.storyId)
    if (!parsed) {
      throw new Error(`Invalid story id: ${input.storyId}`)
    }
    return findSourceById(input.workspaceRoot, input.adapters, parsed.frameworkId, parsed.localId)
  }

  return findSourceByPath(input.workspaceRoot, input.adapters, input.filePath as string)
}

export async function loadStoryDetail(input: {
  workspaceRoot: string
  adapters: FrameworkAdapter[]
  storyId?: string
  filePath?: string
}): Promise<StoryDetail> {
  const source = await resolveStorySource(input)
  const title = getTitleFromContent(source.feature.content)

  return {
    id: makeFeatureId(source.frameworkId, source.localId),
    title,
    status: source.feature.status,
    priority: source.feature.priority,
    labels: [...source.feature.labels],
    assignee: source.feature.assignee,
    path: source.filePath,
    summary: title,
    body: source.feature.content,
    provenance: {
      frameworkId: source.frameworkId,
      localId: source.localId,
      path: source.filePath
    }
  }
}

export async function updateStory(input: {
  workspaceRoot: string
  adapters: FrameworkAdapter[]
  storyId?: string
  filePath?: string
  feature: Feature
}): Promise<StoryDetail> {
  const source = await resolveStorySource(input)
  const serialized = source.adapter.serializeFeature(input.feature, source.rawContent)
  await fs.writeFile(source.filePath, serialized, 'utf8')
  return loadStoryDetail({
    workspaceRoot: input.workspaceRoot,
    adapters: input.adapters,
    storyId: makeFeatureId(source.frameworkId, source.localId)
  })
}
