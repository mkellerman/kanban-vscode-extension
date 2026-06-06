import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { Registry } from './registry'
import { nativeAdapter } from './native'

const root = resolve(__dirname, '__fixtures__/board')

describe('Registry', () => {
  it('detects present frameworks and aggregates their items', async () => {
    const reg = new Registry([nativeAdapter], { root })
    const fw = await reg.detectFrameworks()
    expect(fw.map((f) => f.framework)).toContain('native')
    expect(fw.find((f) => f.framework === 'native')!.itemCount).toBe(2)

    const items = await reg.listItems()
    expect(items.some((i) => i.id === 'native:ready-lane-ui')).toBe(true)
  })

  it('routes an id to its owning adapter', () => {
    const reg = new Registry([nativeAdapter], { root })
    expect(reg.adapterFor('native:ready-lane-ui')?.name).toBe('native')
    expect(reg.adapterFor('bmad:x')).toBeUndefined()
  })
})
