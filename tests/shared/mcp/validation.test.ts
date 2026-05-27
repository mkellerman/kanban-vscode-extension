import { describe, expect, it } from 'vitest'
import { buildSelectionResponse } from '../../../src/shared/mcp/contracts'
import { validateStoryResponse } from '../../../src/shared/mcp/validation'

describe('validateStoryResponse', () => {
  it('accepts a validated selection response', () => {
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

    expect(() => validateStoryResponse(response)).not.toThrow()
  })

  it('rejects payloads without validated metadata', () => {
    expect(() =>
      validateStoryResponse({
        metadata: {
          mcpVersion: '1.0.0',
          schemaVersion: '1.0.0',
          createdAt: '2026-05-27T00:00:00.000Z',
          executionTimeMs: 1,
          agentUsed: 'claude',
          sourceCount: 0,
          sources: [],
          validation: { schema: 'pass', dependencyCheck: 'pass' },
          mode: 'detail'
        },
        story: {
          id: 'native:a',
          title: 'A',
          status: 'todo',
          priority: 'medium',
          labels: [],
          assignee: null,
          path: 'a.md'
        }
      })
    ).toThrow(/validated/i)
  })
})
