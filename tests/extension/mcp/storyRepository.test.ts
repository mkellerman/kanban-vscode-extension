import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Feature } from '../../../src/shared/types'
import type { FrameworkAdapter } from '../../../src/extension/frameworks/FrameworkAdapter'
import {
  loadStoryDetail,
  resolveStorySource,
  updateStory
} from '../../../src/extension/mcp/storyRepository'

type MockAdapter = FrameworkAdapter & {
  serializeFeature: ReturnType<typeof vi.fn>
}

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
})

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-story-repository-'))
  tempDirs.push(dir)
  return dir
}

function makeFeature(overrides: Partial<Feature>): Feature {
  return {
    id: 'alpha',
    status: 'todo',
    priority: 'medium',
    assignee: null,
    epic: null,
    dueDate: null,
    created: '2026-05-27T00:00:00.000Z',
    modified: '2026-05-27T00:00:00.000Z',
    completedAt: null,
    labels: [],
    order: 'a0',
    content: '# Alpha\n\nBody',
    filePath: '',
    ...overrides
  }
}

function makeAdapter(
  id: MockAdapter['id'],
  files: Record<string, Feature>,
  serializeFeature: MockAdapter['serializeFeature'] = vi.fn()
): MockAdapter {
  return {
    id,
    name: id,
    usesDoneSubfolder: false,
    detect: vi.fn(async () => true),
    getWatchPatterns: vi.fn(() => []),
    getFiles: vi.fn(async () => Object.keys(files)),
    parseFile: vi.fn((content: string, filePath: string) => {
      const feature = files[filePath]
      return feature ? { ...feature, filePath } : null
    }),
    serializeFeature,
    createFeature: vi.fn(),
    moveFile: vi.fn()
  }
}

describe('resolveStorySource', () => {
  it('resolves a namespaced story id to the owning adapter', async () => {
    const workspaceRoot = await makeWorkspace()
    const nativePath = path.join(workspaceRoot, 'native-alpha.md')
    await fs.writeFile(nativePath, 'native')

    const nativeAdapter = makeAdapter('native', {
      [nativePath]: makeFeature({ id: 'alpha', filePath: nativePath })
    })
    const superpowersAdapter = makeAdapter('superpowers', {})

    const source = await resolveStorySource({
      workspaceRoot,
      adapters: [superpowersAdapter, nativeAdapter],
      storyId: 'native:alpha'
    })

    expect(source.adapter.id).toBe('native')
    expect(source.filePath).toBe(nativePath)
    expect(source.localId).toBe('alpha')
  })

  it('resolves a raw file path to the owning adapter', async () => {
    const workspaceRoot = await makeWorkspace()
    const nativePath = path.join(workspaceRoot, 'native-alpha.md')
    await fs.writeFile(nativePath, 'native')

    const nativeAdapter = makeAdapter('native', {
      [nativePath]: makeFeature({ id: 'alpha', filePath: nativePath })
    })

    const source = await resolveStorySource({
      workspaceRoot,
      adapters: [nativeAdapter],
      filePath: nativePath
    })

    expect(source.adapter.id).toBe('native')
    expect(source.filePath).toBe(nativePath)
    expect(source.localId).toBe('alpha')
  })
})

describe('loadStoryDetail', () => {
  it('loads body text and provenance for the owning adapter', async () => {
    const workspaceRoot = await makeWorkspace()
    const nativePath = path.join(workspaceRoot, 'native-alpha.md')
    await fs.writeFile(nativePath, 'native')

    const nativeAdapter = makeAdapter('native', {
      [nativePath]: makeFeature({
        id: 'alpha',
        content: '# Alpha\n\nBody text',
        filePath: nativePath
      })
    })

    const detail = await loadStoryDetail({
      workspaceRoot,
      adapters: [nativeAdapter],
      storyId: 'native:alpha'
    })

    expect(detail.id).toBe('native:alpha')
    expect(detail.body).toBe('# Alpha\n\nBody text')
    expect(detail.provenance).toEqual({
      frameworkId: 'native',
      localId: 'alpha',
      path: nativePath
    })
  })
})

describe('updateStory', () => {
  it('writes through the owning adapter without losing framework-specific content', async () => {
    const workspaceRoot = await makeWorkspace()
    const nativePath = path.join(workspaceRoot, 'native-alpha.md')
    const originalContent = ['<framework-wrapper>', '# Alpha', '', 'Body text', '</framework-wrapper>'].join('\n')
    await fs.writeFile(nativePath, originalContent)

    const serializeFeature = vi.fn((feature: Feature, original: string) => {
      return original.replace('Body text', feature.content)
    })
    const nativeAdapter = makeAdapter('native', {
      [nativePath]: makeFeature({
        id: 'alpha',
        content: '# Alpha\n\nBody text',
        filePath: nativePath
      })
    }, serializeFeature)

    await updateStory({
      workspaceRoot,
      adapters: [nativeAdapter],
      storyId: 'native:alpha',
      feature: makeFeature({
        id: 'alpha',
        status: 'review',
        content: '# Alpha\n\nUpdated body',
        filePath: nativePath
      })
    })

    expect(serializeFeature).toHaveBeenCalledOnce()
    expect(serializeFeature).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'review',
        content: '# Alpha\n\nUpdated body'
      }),
      originalContent
    )
    expect(await fs.readFile(nativePath, 'utf8')).toContain('Updated body')
    expect(await fs.readFile(nativePath, 'utf8')).toContain('<framework-wrapper>')
  })
})
