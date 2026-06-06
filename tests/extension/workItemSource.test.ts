import { describe, it, expect } from 'vitest'
import { toFeature } from '../../src/extension/workItemSource'
import type { WorkItem } from '@kanban/backlog-mcp'

const wi: WorkItem = {
  id: 'native:ready-lane-ui',
  source: { framework: 'native', path: 'p/story.md' },
  type: 'story',
  title: 'Ready lane UI',
  status: 'todo',
  priority: 'high',
  parent: null,
  children: [],
  dependsOn: ['native:dependency-graph'],
  labels: ['ui'],
  estimate: null,
  acceptanceCriteria: [],
  bodyRef: 'b'
}

describe('toFeature', () => {
  it('maps a WorkItem to the board Feature shape', () => {
    const f = toFeature(wi)
    expect(f.id).toBe('native:ready-lane-ui')
    expect(f.status).toBe('todo') // → column id
    expect(f.priority).toBe('high')
    expect(f.labels).toEqual(['ui'])
    expect(f.filePath).toBe('p/story.md')
    expect(f.content).toContain('Ready lane UI') // title renders from content
    expect(f._extraFrontmatter?.source).toBe('native') // provenance
    expect(f._extraFrontmatter?.dependsOn).toBe('native:dependency-graph')
  })

  it('maps non-column statuses into a valid column', () => {
    expect(toFeature({ ...wi, status: 'blocked' }).status).toBe('todo')
    expect(toFeature({ ...wi, status: 'cancelled' }).status).toBe('done')
    expect(toFeature({ ...wi, priority: null }).priority).toBe('medium')
  })
})
