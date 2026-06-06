import { describe, it, expect } from 'vitest'
import { resolve, join } from 'node:path'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { nativeAdapter } from './native'

const root = resolve(__dirname, '__fixtures__/board')

describe('native adapter', () => {
  it('detects a .kanban board', async () => {
    expect(await nativeAdapter.detect({ root })).toBe(true)
    expect(await nativeAdapter.detect({ root: resolve(__dirname, 'nope') })).toBe(false)
  })

  it('reads story folders into namespaced WorkItems with deps', async () => {
    const items = await nativeAdapter.listItems({ root })
    const ready = items.find((i) => i.id === 'native:ready-lane-ui')
    expect(ready).toBeDefined()
    expect(ready!.status).toBe('todo')
    expect(ready!.priority).toBe('high')
    expect(ready!.title).toBe('Ready lane UI')
    expect(ready!.dependsOn).toEqual(['native:dependency-graph']) // namespaced
    expect(ready!.acceptanceCriteria).toContain('shows ready items')

    expect(items.find((i) => i.id === 'native:dependency-graph')!.status).toBe('done')
  })

  it('reads a body', async () => {
    const body = await nativeAdapter.getBody({ root }, 'native:ready-lane-ui')
    expect(body).toMatch(/# Ready lane UI/)
  })

  it('setStatus writes status back to story.md (round-trip)', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      const dir = join(tmp, '.kanban', 'features', 'x')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'story.md'), '---\nid: "x"\nstatus: "todo"\npriority: "low"\n---\n# X\n', 'utf8')
      await nativeAdapter.setStatus!({ root: tmp }, 'native:x', 'in-progress')
      const items = await nativeAdapter.listItems({ root: tmp })
      expect(items.find((i) => i.id === 'native:x')?.status).toBe('in-progress')
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

describe('native adapter — done/ path resolution', () => {
  async function makeDoneItem(root: string, itemId: string): Promise<void> {
    const dir = join(root, '.kanban', 'features', 'done', itemId)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'story.md'),
      `---\nid: "${itemId}"\nstatus: "done"\npriority: "low"\n---\n# Item ${itemId}\n`,
      'utf8'
    )
  }

  it('setStatus writes correctly when item lives in done/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      await makeDoneItem(root, 'done-item')
      await nativeAdapter.setStatus!({ root }, 'native:done-item', 'in-progress')
      const items = await nativeAdapter.listItems({ root })
      expect(items.find((i) => i.id === 'native:done-item')?.status).toBe('in-progress')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('getBody reads correctly when item lives in done/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      await makeDoneItem(root, 'done-body')
      const body = await nativeAdapter.getBody({ root }, 'native:done-body')
      expect(body).toMatch(/# Item done-body/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('getBody throws for a story that does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa-native-'))
    try {
      await mkdir(join(root, '.kanban', 'features'), { recursive: true })
      await expect(nativeAdapter.getBody({ root }, 'native:missing')).rejects.toThrow(
        'story not found: missing'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
