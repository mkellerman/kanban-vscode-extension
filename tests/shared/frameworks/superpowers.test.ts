import { describe, it, expect } from 'vitest'
import { parseSuperpowersFile, serializeSuperpowersFeature } from '../../../src/shared/frameworks/superpowers'

const FIXTURE_PATH = '/workspace/docs/superpowers/plans/my-plan-2026-05-27.md'

function makeFrontmatterContent(overrides: Record<string, string> = {}, body = '# My Plan\n\nSome content.'): string {
  const fields: Record<string, string> = {
    id: '"my-plan-2026-05-27"',
    status: '"in-progress"',
    priority: '"high"',
    assignee: '"alice"',
    epic: '"MCP Layer"',
    dueDate: '"2026-06-01"',
    created: '"2026-05-27T00:00:00.000Z"',
    modified: '"2026-05-27T12:00:00.000Z"',
    completedAt: 'null',
    labels: '["backend", "mcp"]',
    order: '"a1"',
    ...overrides
  }
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n${body}`
}

// ---------------------------------------------------------------------------
// parseSuperpowersFile
// ---------------------------------------------------------------------------

describe('parseSuperpowersFile — with frontmatter', () => {
  it('parses all kanban fields correctly', () => {
    const content = makeFrontmatterContent()
    const feature = parseSuperpowersFile(content, FIXTURE_PATH)

    expect(feature.id).toBe('my-plan-2026-05-27')
    expect(feature.status).toBe('in-progress')
    expect(feature.priority).toBe('high')
    expect(feature.assignee).toBe('alice')
    expect(feature.epic).toBe('MCP Layer')
    expect(feature.dueDate).toBe('2026-06-01')
    expect(feature.created).toBe('2026-05-27T00:00:00.000Z')
    expect(feature.modified).toBe('2026-05-27T12:00:00.000Z')
    expect(feature.completedAt).toBeNull()
    expect(feature.labels).toEqual(['backend', 'mcp'])
    expect(feature.order).toBe('a1')
    expect(feature.content).toBe('# My Plan\n\nSome content.')
    expect(feature.filePath).toBe(FIXTURE_PATH)
  })

  it('returns null for null-valued fields', () => {
    const content = makeFrontmatterContent({ assignee: 'null', dueDate: 'null', completedAt: 'null', epic: 'null' })
    const feature = parseSuperpowersFile(content, FIXTURE_PATH)
    expect(feature.assignee).toBeNull()
    expect(feature.dueDate).toBeNull()
    expect(feature.completedAt).toBeNull()
    expect(feature.epic).toBeNull()
  })

  it('falls back to filename (without extension) as id when id is missing', () => {
    const lines = ['status: "backlog"', 'priority: "medium"']
    const content = `---\n${lines.join('\n')}\n---\n`
    const feature = parseSuperpowersFile(content, FIXTURE_PATH)
    expect(feature.id).toBe('my-plan-2026-05-27')
  })

  it('defaults status to "backlog" when missing', () => {
    const content = `---\nid: "x"\n---\n`
    expect(parseSuperpowersFile(content, FIXTURE_PATH).status).toBe('backlog')
  })

  it('defaults priority to "medium" when missing', () => {
    const content = `---\nid: "x"\n---\n`
    expect(parseSuperpowersFile(content, FIXTURE_PATH).priority).toBe('medium')
  })

  it('defaults order to "a0" when missing', () => {
    const content = `---\nid: "x"\n---\n`
    expect(parseSuperpowersFile(content, FIXTURE_PATH).order).toBe('a0')
  })

  it('ignores non-kanban keys in frontmatter (does not throw)', () => {
    const content = `---\nid: "x"\nstatus: "todo"\ngoal: "Build MCP"\narchitecture: "Thin layer"\n---\n# Body`
    const feature = parseSuperpowersFile(content, FIXTURE_PATH)
    expect(feature.status).toBe('todo')
    expect(feature.content).toBe('# Body')
  })

  it('normalises CRLF line endings before parsing', () => {
    const content = makeFrontmatterContent().replace(/\n/g, '\r\n')
    const feature = parseSuperpowersFile(content, FIXTURE_PATH)
    expect(feature.id).toBe('my-plan-2026-05-27')
    expect(feature.status).toBe('in-progress')
  })
})

describe('parseSuperpowersFile — without frontmatter', () => {
  it('returns Feature with backlog defaults for a plain markdown file', () => {
    const content = '# My Plan\n\nSome content.'
    const feature = parseSuperpowersFile(content, FIXTURE_PATH)

    expect(feature.id).toBe('my-plan-2026-05-27')
    expect(feature.status).toBe('backlog')
    expect(feature.priority).toBe('medium')
    expect(feature.assignee).toBeNull()
    expect(feature.epic).toBeNull()
    expect(feature.dueDate).toBeNull()
    expect(feature.completedAt).toBeNull()
    expect(feature.labels).toEqual([])
    expect(feature.order).toBe('a0')
    expect(feature.content).toBe('# My Plan\n\nSome content.')
    expect(feature.filePath).toBe(FIXTURE_PATH)
  })

  it('handles empty content', () => {
    const feature = parseSuperpowersFile('', FIXTURE_PATH)
    expect(feature.status).toBe('backlog')
    expect(feature.content).toBe('')
  })

  it('never returns null (always a Feature)', () => {
    const result = parseSuperpowersFile('# Just a heading', FIXTURE_PATH)
    expect(result).not.toBeNull()
    expect(typeof result).toBe('object')
  })
})

// ---------------------------------------------------------------------------
// serializeSuperpowersFeature
// ---------------------------------------------------------------------------

describe('serializeSuperpowersFeature — existing frontmatter', () => {
  it('updates kanban keys while preserving non-kanban keys', () => {
    const original = `---
id: "my-plan-2026-05-27"
status: "todo"
priority: "medium"
assignee: null
epic: null
dueDate: null
created: "2026-05-27T00:00:00.000Z"
modified: "2026-05-27T00:00:00.000Z"
completedAt: null
labels: []
order: "a0"
goal: "Build the MCP server"
architecture: "Thin MCP layer"
---
# My Plan
`
    const feature = parseSuperpowersFile(original, FIXTURE_PATH)
    const updated = { ...feature, status: 'in-progress' as const, priority: 'high' as const }
    const result = serializeSuperpowersFeature(updated, original)

    expect(result).toContain('goal: "Build the MCP server"')
    expect(result).toContain('architecture: "Thin MCP layer"')
    expect(result).toContain('status: "in-progress"')
    expect(result).toContain('priority: "high"')
    expect(result).toContain('# My Plan')
  })

  it('preserves body content after frontmatter', () => {
    const original = makeFrontmatterContent({}, '# Title\n\nDetailed plan body.')
    const feature = parseSuperpowersFile(original, FIXTURE_PATH)
    const result = serializeSuperpowersFeature(feature, original)
    expect(result).toContain('# Title\n\nDetailed plan body.')
  })

  it('appends missing kanban keys to the frontmatter', () => {
    const original = `---
status: "todo"
goal: "Something important"
---
# Body
`
    const feature = parseSuperpowersFile(original, FIXTURE_PATH)
    const result = serializeSuperpowersFeature(feature, original)

    expect(result).toContain('id:')
    expect(result).toContain('priority:')
    expect(result).toContain('order:')
    expect(result).toContain('goal: "Something important"')
  })

  it('writes null fields as literal null (not quoted)', () => {
    const original = makeFrontmatterContent()
    const feature = { ...parseSuperpowersFile(original, FIXTURE_PATH), assignee: null, dueDate: null, completedAt: null }
    const result = serializeSuperpowersFeature(feature, original)
    expect(result).toContain('assignee: null')
    expect(result).toContain('dueDate: null')
    expect(result).toContain('completedAt: null')
    expect(result).not.toContain('"null"')
  })

  it('serializes labels as a bracketed list of quoted strings', () => {
    const original = makeFrontmatterContent({ labels: '[]' })
    const feature = { ...parseSuperpowersFile(original, FIXTURE_PATH), labels: ['alpha', 'beta'] }
    const result = serializeSuperpowersFeature(feature, original)
    expect(result).toContain('labels: ["alpha", "beta"]')
  })
})

describe('serializeSuperpowersFeature — first write (no frontmatter)', () => {
  it('injects a frontmatter block at the top', () => {
    const original = '# My Plan\n\nSome content.'
    const feature = parseSuperpowersFile(original, FIXTURE_PATH)
    const result = serializeSuperpowersFeature(feature, original)

    expect(result).toMatch(/^---\n/)
    expect(result).toContain('status: "backlog"')
    expect(result).toContain('priority: "medium"')
    expect(result).toContain('order: "a0"')
    expect(result).toContain('# My Plan')
    expect(result).toContain('Some content.')
  })

  it('preserves the original markdown body after injected frontmatter', () => {
    const original = '# Title\n\nParagraph one.\n\nParagraph two.'
    const feature = parseSuperpowersFile(original, FIXTURE_PATH)
    const result = serializeSuperpowersFeature(feature, original)

    expect(result).toContain('Paragraph one.')
    expect(result).toContain('Paragraph two.')
  })
})

// ---------------------------------------------------------------------------
// Round-trip: parse → serialize → parse
// ---------------------------------------------------------------------------

describe('round-trip: parseSuperpowersFile → serializeSuperpowersFeature → parseSuperpowersFile', () => {
  it('recovers all kanban fields faithfully', () => {
    const original = makeFrontmatterContent()
    const feature = parseSuperpowersFile(original, FIXTURE_PATH)
    const serialized = serializeSuperpowersFeature(feature, original)
    const recovered = parseSuperpowersFile(serialized, FIXTURE_PATH)

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

  it('round-trips a first-write (no frontmatter) without data loss', () => {
    const original = '# My Plan\n\nContent here.'
    const feature = parseSuperpowersFile(original, FIXTURE_PATH)
    const serialized = serializeSuperpowersFeature(feature, original)
    const recovered = parseSuperpowersFile(serialized, FIXTURE_PATH)

    expect(recovered.status).toBe('backlog')
    expect(recovered.labels).toEqual([])
    expect(recovered.content).toBe('# My Plan\n\nContent here.')
  })
})
