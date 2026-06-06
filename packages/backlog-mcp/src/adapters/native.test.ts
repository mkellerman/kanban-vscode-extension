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
