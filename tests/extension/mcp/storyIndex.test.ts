import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Feature } from '../../../src/shared/types'
import type { FrameworkAdapter } from '../../../src/extension/frameworks/FrameworkAdapter'
import { listStoriesForSelection } from '../../../src/extension/mcp/storyIndex'

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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-story-index-'))
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
  files: Record<string, Feature>
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
    serializeFeature: vi.fn(),
    createFeature: vi.fn(),
    moveFile: vi.fn()
  }
}

describe('listStoriesForSelection', () => {
  it('returns namespaced stories across adapters in a stable adapter-id order', async () => {
    const workspaceRoot = await makeWorkspace()
    const nativePath = path.join(workspaceRoot, 'native-alpha.md')
    const superpowersPath = path.join(workspaceRoot, 'superpowers-beta.md')

    await fs.writeFile(nativePath, 'native')
    await fs.writeFile(superpowersPath, 'superpowers')

    const nativeAdapter = makeAdapter('native', {
      [nativePath]: makeFeature({
        id: 'alpha',
        content: '# Alpha\n\nNative body',
        filePath: nativePath
      })
    })
    const superpowersAdapter = makeAdapter('superpowers', {
      [superpowersPath]: makeFeature({
        id: 'beta',
        status: 'todo',
        priority: 'high',
        content: '# Beta\n\nSuperpowers body',
        filePath: superpowersPath
      })
    })

    const stories = await listStoriesForSelection({
      workspaceRoot,
      adapters: [superpowersAdapter, nativeAdapter],
      status: 'todo'
    })

    expect(stories.map((story) => story.id)).toEqual(['native:alpha', 'superpowers:beta'])
    expect(stories[0]?.path).toBe(nativePath)
    expect(stories[1]?.path).toBe(superpowersPath)
    expect(stories[0]?.summary).toBe('Alpha')
  })
})
