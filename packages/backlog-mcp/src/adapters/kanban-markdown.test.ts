import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { kanbanMarkdownAdapter } from './kanban-markdown'
import { nativeAdapter } from './native'

const root = resolve(__dirname, '__fixtures__/km-board')

describe('kanban-markdown adapter', () => {
  it('detects flat .md card files (and not the folder format)', async () => {
    expect(await kanbanMarkdownAdapter.detect({ root })).toBe(true)
    // the native fixture board uses story folders, not flat files → km finds nothing
    expect(await kanbanMarkdownAdapter.detect({ root: resolve(__dirname, '__fixtures__/board') })).toBe(false)
  })

  it('reads flat cards into namespaced WorkItems', async () => {
    const items = await kanbanMarkdownAdapter.listItems({ root })
    expect(items.map((i) => i.id).sort()).toEqual([
      'kanban-markdown:add-search',
      'kanban-markdown:fix-login',
      'kanban-markdown:old-task'
    ])
    const search = items.find((i) => i.id === 'kanban-markdown:add-search')!
    expect(search.title).toBe('Add search')
    expect(search.priority).toBe('medium')
    expect(search.parent).toBe('kanban-markdown:search') // epic → parent
    expect(search.labels).toEqual(['ui'])
    expect(search.dependsOn).toEqual([]) // no dependency concept in this format
    expect(search.acceptanceCriteria).toContain('filter by text')
  })

  it('treats the done/ folder as authoritative status', async () => {
    const items = await kanbanMarkdownAdapter.listItems({ root })
    expect(items.find((i) => i.id === 'kanban-markdown:old-task')!.status).toBe('done')
  })

  it('is read-only (no setStatus) unlike native', () => {
    expect(kanbanMarkdownAdapter.setStatus).toBeUndefined()
    expect(typeof nativeAdapter.setStatus).toBe('function')
  })
})
