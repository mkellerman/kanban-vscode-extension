import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
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

    const dep = items.find((i) => i.id === 'native:dependency-graph')
    expect(dep!.status).toBe('done')
  })

  it('reads a body and writes status (read+write)', async () => {
    const body = await nativeAdapter.getBody({ root }, 'native:ready-lane-ui')
    expect(body).toMatch(/# Ready lane UI/)
    expect(typeof nativeAdapter.setStatus).toBe('function')
  })
})
