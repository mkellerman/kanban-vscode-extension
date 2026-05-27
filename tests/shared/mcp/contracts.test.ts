import { describe, expect, it } from 'vitest'
import { buildDetailResponse, buildSelectionResponse, buildStoryResponse } from '../../../src/shared/mcp/contracts'

describe('buildSelectionResponse', () => {
  it('creates a validated selection envelope with numbered-menu guidance', () => {
    const response = buildSelectionResponse({
      agentUsed: 'claude-4.1',
      sources: [{ path: '.devtool/features/a.md' }],
      stories: [
        {
          id: 'native:a',
          title: 'A',
          status: 'todo',
          priority: 'medium',
          labels: [],
          assignee: null,
          path: '.devtool/features/a.md',
          summary: 'A'
        }
      ]
    })

    expect(response.metadata.mode).toBe('selection')
    expect(response.metadata.validated).toBe(true)
    expect(response.metadata.sourceCount).toBe(1)
    expect(response.metadata.selectionInstruction).toMatch(/numbered menu/i)
    expect(response.metadata.validation.schema).toBe('pass')
    expect(response.metadata.validation.dependencyCheck).toBe('pass')
    expect(response.stories).toHaveLength(1)
  })
})

describe('buildDetailResponse', () => {
  it('stamps shared metadata and omits selection guidance', () => {
    const response = buildDetailResponse({
      agentUsed: 'claude-4.1',
      sources: [],
      story: {
        id: 'native:a',
        title: 'A',
        status: 'todo',
        priority: 'medium',
        labels: [],
        assignee: null,
        path: '.devtool/features/a.md',
        summary: 'A'
      }
    })

    expect(response.metadata.mode).toBe('detail')
    expect(response.metadata.validated).toBe(true)
    expect(response.metadata.sourceCount).toBe(0)
    expect(response.metadata.selectionInstruction).toBeUndefined()
    expect(response.story.id).toBe('native:a')
  })
})

describe('buildStoryResponse', () => {
  it('stamps shared metadata for story payloads', () => {
    const response = buildStoryResponse({
      mode: 'updated',
      agentUsed: 'codex',
      sources: [{ path: 'a.md' }, { path: 'b.md' }],
      story: {
        id: 'native:a',
        title: 'A',
        status: 'done',
        priority: 'high',
        labels: ['x'],
        assignee: 'sam',
        path: 'a.md',
        summary: 'A'
      }
    })

    expect(response.metadata.mode).toBe('updated')
    expect(response.metadata.validated).toBe(true)
    expect(response.metadata.sourceCount).toBe(2)
    expect(response.metadata.agentUsed).toBe('codex')
  })
})
