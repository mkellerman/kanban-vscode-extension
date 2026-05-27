import { describe, it, expect } from 'vitest'
import { parseNativeFile, serializeNativeFeature } from '../../../src/shared/frameworks/native'

const FIXTURE_PATH = '/workspace/.devtool/features/my-feature-2026-05-27.md'

function makeFrontmatterContent(overrides: Record<string, string> = {}, body = '# My Feature\n\nFeature content.'): string {
  const fields: Record<string, string> = {
    id: '"my-feature-2026-05-27"',
    status: '"in-progress"',
    priority: '"high"',
    assignee: '"alice"',
    epic: '"MCP Layer"',
    dueDate: '"2026-06-01"',
    created: '"2026-05-27T00:00:00.000Z"',
    modified: '"2026-05-27T12:00:00.000Z"',
    completedAt: 'null',
    labels: '["backend", "core"]',
    order: '"a1"',
    ...overrides
  }
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n${body}`
}

// ---------------------------------------------------------------------------
// parseNativeFile — returns null without frontmatter (key native behaviour)
// ---------------------------------------------------------------------------

describe('parseNativeFile — without frontmatter', () => {
  it('returns null for plain markdown (no frontmatter block)', () => {
    expect(parseNativeFile('# My Feature\n\nSome content.', FIXTURE_PATH)).toBeNull()
  })

  it('returns null for empty content', () => {
    expect(parseNativeFile('', FIXTURE_PATH)).toBeNull()
  })

  it('returns null for a heading-only file', () => {
    expect(parseNativeFile('# Just a heading', FIXTURE_PATH)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseNativeFile — with frontmatter
// ---------------------------------------------------------------------------

describe('parseNativeFile — with frontmatter', () => {
  it('parses all kanban fields correctly', () => {
    const content = makeFrontmatterContent()
    const feature = parseNativeFile(content, FIXTURE_PATH)!

    expect(feature.id).toBe('my-feature-2026-05-27')
    expect(feature.status).toBe('in-progress')
    expect(feature.priority).toBe('high')
    expect(feature.assignee).toBe('alice')
    expect(feature.epic).toBe('MCP Layer')
    expect(feature.dueDate).toBe('2026-06-01')
    expect(feature.created).toBe('2026-05-27T00:00:00.000Z')
    expect(feature.modified).toBe('2026-05-27T12:00:00.000Z')
    expect(feature.completedAt).toBeNull()
    expect(feature.labels).toEqual(['backend', 'core'])
    expect(feature.order).toBe('a1')
    expect(feature.content).toBe('# My Feature\n\nFeature content.')
    expect(feature.filePath).toBe(FIXTURE_PATH)
  })

  it('returns null for null-valued optional fields', () => {
    const content = makeFrontmatterContent({ assignee: 'null', dueDate: 'null', completedAt: 'null', epic: 'null' })
    const feature = parseNativeFile(content, FIXTURE_PATH)!
    expect(feature.assignee).toBeNull()
    expect(feature.dueDate).toBeNull()
    expect(feature.completedAt).toBeNull()
    expect(feature.epic).toBeNull()
  })

  it('falls back to filename (without extension) as id when id is missing', () => {
    const content = `---\nstatus: "backlog"\n---\n`
    expect(parseNativeFile(content, FIXTURE_PATH)!.id).toBe('my-feature-2026-05-27')
  })

  it('defaults status to "backlog" when missing', () => {
    const content = `---\nid: "x"\n---\n`
    expect(parseNativeFile(content, FIXTURE_PATH)!.status).toBe('backlog')
  })

  it('defaults priority to "medium" when missing', () => {
    const content = `---\nid: "x"\n---\n`
    expect(parseNativeFile(content, FIXTURE_PATH)!.priority).toBe('medium')
  })

  it('defaults order to "a0" when missing', () => {
    const content = `---\nid: "x"\n---\n`
    expect(parseNativeFile(content, FIXTURE_PATH)!.order).toBe('a0')
  })

  it('defaults labels to empty array when missing', () => {
    const content = `---\nid: "x"\n---\n`
    expect(parseNativeFile(content, FIXTURE_PATH)!.labels).toEqual([])
  })

  it('normalises CRLF line endings before parsing', () => {
    const content = makeFrontmatterContent().replace(/\n/g, '\r\n')
    const feature = parseNativeFile(content, FIXTURE_PATH)!
    expect(feature.id).toBe('my-feature-2026-05-27')
    expect(feature.status).toBe('in-progress')
  })

  it('trims the body content', () => {
    const content = `---\nid: "x"\n---\n\n# Title\n\nBody.\n\n`
    expect(parseNativeFile(content, FIXTURE_PATH)!.content).toBe('# Title\n\nBody.')
  })

  it('returns an empty string content for a file with only frontmatter', () => {
    const content = `---\nid: "x"\n---\n`
    expect(parseNativeFile(content, FIXTURE_PATH)!.content).toBe('')
  })
})

// ---------------------------------------------------------------------------
// serializeNativeFeature
// ---------------------------------------------------------------------------

describe('serializeNativeFeature', () => {
  it('starts with a frontmatter block', () => {
    const feature = parseNativeFile(makeFrontmatterContent(), FIXTURE_PATH)!
    expect(serializeNativeFeature(feature)).toMatch(/^---\n/)
  })

  it('includes all kanban fields in the output', () => {
    const feature = parseNativeFile(makeFrontmatterContent(), FIXTURE_PATH)!
    const result = serializeNativeFeature(feature)
    expect(result).toContain('id: "my-feature-2026-05-27"')
    expect(result).toContain('status: "in-progress"')
    expect(result).toContain('priority: "high"')
    expect(result).toContain('assignee: "alice"')
    expect(result).toContain('epic: "MCP Layer"')
    expect(result).toContain('dueDate: "2026-06-01"')
    expect(result).toContain('created: "2026-05-27T00:00:00.000Z"')
    expect(result).toContain('modified: "2026-05-27T12:00:00.000Z"')
    expect(result).toContain('order: "a1"')
  })

  it('writes null fields as literal null (not quoted)', () => {
    const feature = parseNativeFile(makeFrontmatterContent(), FIXTURE_PATH)!
    const withNulls = { ...feature, assignee: null, dueDate: null, completedAt: null, epic: null }
    const result = serializeNativeFeature(withNulls)
    expect(result).toContain('assignee: null')
    expect(result).toContain('dueDate: null')
    expect(result).toContain('completedAt: null')
    expect(result).toContain('epic: null')
    expect(result).not.toContain('"null"')
  })

  it('serializes labels as a bracketed list of quoted strings', () => {
    const feature = { ...parseNativeFile(makeFrontmatterContent(), FIXTURE_PATH)!, labels: ['alpha', 'beta'] }
    expect(serializeNativeFeature(feature)).toContain('labels: ["alpha", "beta"]')
  })

  it('serializes an empty labels array as []', () => {
    const feature = { ...parseNativeFile(makeFrontmatterContent(), FIXTURE_PATH)!, labels: [] }
    expect(serializeNativeFeature(feature)).toContain('labels: []')
  })

  it('appends the feature content after the frontmatter', () => {
    const feature = parseNativeFile(makeFrontmatterContent(), FIXTURE_PATH)!
    const result = serializeNativeFeature(feature)
    expect(result).toContain('# My Feature\n\nFeature content.')
  })
})

// ---------------------------------------------------------------------------
// Round-trip: parse → serialize → parse
// ---------------------------------------------------------------------------

describe('round-trip: parseNativeFile → serializeNativeFeature → parseNativeFile', () => {
  it('recovers all kanban fields faithfully', () => {
    const original = makeFrontmatterContent()
    const feature = parseNativeFile(original, FIXTURE_PATH)!
    const serialized = serializeNativeFeature(feature)
    const recovered = parseNativeFile(serialized, FIXTURE_PATH)!

    expect(recovered.id).toBe(feature.id)
    expect(recovered.status).toBe(feature.status)
    expect(recovered.priority).toBe(feature.priority)
    expect(recovered.assignee).toBe(feature.assignee)
    expect(recovered.epic).toBe(feature.epic)
    expect(recovered.dueDate).toBe(feature.dueDate)
    expect(recovered.created).toBe(feature.created)
    expect(recovered.modified).toBe(feature.modified)
    expect(recovered.completedAt).toBe(feature.completedAt)
    expect(recovered.labels).toEqual(feature.labels)
    expect(recovered.order).toBe(feature.order)
  })

  it('preserves body content across round-trip', () => {
    const body = '# Title\n\n## Section\n\nParagraph.'
    const original = makeFrontmatterContent({}, body)
    const feature = parseNativeFile(original, FIXTURE_PATH)!
    const serialized = serializeNativeFeature(feature)
    const recovered = parseNativeFile(serialized, FIXTURE_PATH)!
    expect(recovered.content).toBe(body)
  })

  it('serialized output is parseable (never returns null after serialize)', () => {
    const original = makeFrontmatterContent()
    const feature = parseNativeFile(original, FIXTURE_PATH)!
    const serialized = serializeNativeFeature(feature)
    expect(parseNativeFile(serialized, FIXTURE_PATH)).not.toBeNull()
  })
})
