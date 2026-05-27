import { describe, it, expect } from 'vitest'
import { parseSpeckitFile, serializeSpeckitFeature } from '../../../src/shared/frameworks/speckit'

// .specify/specs/{slug}/spec.md — localId is derived from the parent directory
const FIXTURE_PATH = '/workspace/.specify/specs/my-feature-slug/spec.md'

function makeFrontmatterContent(overrides: Record<string, string> = {}, body = '# My Spec\n\nSpec content.'): string {
  const fields: Record<string, string> = {
    id: '"my-feature-slug"',
    status: '"in-progress"',
    priority: '"high"',
    assignee: '"alice"',
    epic: 'null',
    dueDate: '"2026-06-01"',
    created: '"2026-05-27T00:00:00.000Z"',
    modified: '"2026-05-27T12:00:00.000Z"',
    completedAt: 'null',
    labels: '["backend", "spec"]',
    order: '"a1"',
    ...overrides
  }
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n${body}`
}

// ---------------------------------------------------------------------------
// parseSpeckitFile
// ---------------------------------------------------------------------------

describe('parseSpeckitFile — localId', () => {
  it('derives localId from the parent directory name, not the filename', () => {
    const content = '# Spec content'
    const feature = parseSpeckitFile(content, FIXTURE_PATH)
    expect(feature.id).toBe('my-feature-slug')
  })

  it('uses frontmatter id when present, ignoring the parent dir name', () => {
    const content = makeFrontmatterContent({ id: '"explicit-id"' })
    const feature = parseSpeckitFile(content, FIXTURE_PATH)
    expect(feature.id).toBe('explicit-id')
  })

  it('falls back to parent directory name when id is missing from frontmatter', () => {
    const content = `---\nstatus: "todo"\n---\n# Body`
    const feature = parseSpeckitFile(content, '/workspace/.specify/specs/slug-from-dir/spec.md')
    expect(feature.id).toBe('slug-from-dir')
  })
})

describe('parseSpeckitFile — epic is always null', () => {
  it('returns null for epic even when frontmatter has an epic value', () => {
    const content = makeFrontmatterContent({ epic: '"Some Epic"' })
    const feature = parseSpeckitFile(content, FIXTURE_PATH)
    expect(feature.epic).toBeNull()
  })

  it('returns null for epic when frontmatter has epic: null', () => {
    const content = makeFrontmatterContent({ epic: 'null' })
    const feature = parseSpeckitFile(content, FIXTURE_PATH)
    expect(feature.epic).toBeNull()
  })

  it('returns null for epic on a plain markdown file with no frontmatter', () => {
    const feature = parseSpeckitFile('# Spec', FIXTURE_PATH)
    expect(feature.epic).toBeNull()
  })
})

describe('parseSpeckitFile — status defaults to todo', () => {
  it('defaults status to "todo" when no frontmatter is present', () => {
    const feature = parseSpeckitFile('# Spec content', FIXTURE_PATH)
    expect(feature.status).toBe('todo')
  })

  it('defaults status to "todo" when frontmatter has no status key', () => {
    const content = `---\nid: "x"\n---\n`
    expect(parseSpeckitFile(content, FIXTURE_PATH).status).toBe('todo')
  })

  it('parses an explicit status from frontmatter', () => {
    const content = makeFrontmatterContent({ status: '"in-progress"' })
    expect(parseSpeckitFile(content, FIXTURE_PATH).status).toBe('in-progress')
  })
})

describe('parseSpeckitFile — with frontmatter', () => {
  it('parses all kanban fields correctly', () => {
    const content = makeFrontmatterContent()
    const feature = parseSpeckitFile(content, FIXTURE_PATH)

    expect(feature.id).toBe('my-feature-slug')
    expect(feature.status).toBe('in-progress')
    expect(feature.priority).toBe('high')
    expect(feature.assignee).toBe('alice')
    expect(feature.epic).toBeNull()
    expect(feature.dueDate).toBe('2026-06-01')
    expect(feature.created).toBe('2026-05-27T00:00:00.000Z')
    expect(feature.modified).toBe('2026-05-27T12:00:00.000Z')
    expect(feature.completedAt).toBeNull()
    expect(feature.labels).toEqual(['backend', 'spec'])
    expect(feature.order).toBe('a1')
    expect(feature.content).toBe('# My Spec\n\nSpec content.')
    expect(feature.filePath).toBe(FIXTURE_PATH)
  })

  it('returns null for null-valued fields', () => {
    const content = makeFrontmatterContent({ assignee: 'null', dueDate: 'null', completedAt: 'null' })
    const feature = parseSpeckitFile(content, FIXTURE_PATH)
    expect(feature.assignee).toBeNull()
    expect(feature.dueDate).toBeNull()
    expect(feature.completedAt).toBeNull()
  })

  it('defaults priority to "medium" when missing', () => {
    const content = `---\nid: "x"\n---\n`
    expect(parseSpeckitFile(content, FIXTURE_PATH).priority).toBe('medium')
  })

  it('defaults order to "a0" when missing', () => {
    const content = `---\nid: "x"\n---\n`
    expect(parseSpeckitFile(content, FIXTURE_PATH).order).toBe('a0')
  })

  it('ignores non-kanban keys without throwing', () => {
    const content = `---\nid: "x"\nstatus: "todo"\ngoal: "Build feature"\n---\n# Body`
    const feature = parseSpeckitFile(content, FIXTURE_PATH)
    expect(feature.status).toBe('todo')
    expect(feature.content).toBe('# Body')
  })

  it('normalises CRLF line endings before parsing', () => {
    const content = makeFrontmatterContent().replace(/\n/g, '\r\n')
    const feature = parseSpeckitFile(content, FIXTURE_PATH)
    expect(feature.id).toBe('my-feature-slug')
    expect(feature.status).toBe('in-progress')
  })
})

describe('parseSpeckitFile — without frontmatter', () => {
  it('returns Feature with todo defaults for a plain markdown file', () => {
    const content = '# My Spec\n\nSome content.'
    const feature = parseSpeckitFile(content, FIXTURE_PATH)

    expect(feature.id).toBe('my-feature-slug')
    expect(feature.status).toBe('todo')
    expect(feature.priority).toBe('medium')
    expect(feature.assignee).toBeNull()
    expect(feature.epic).toBeNull()
    expect(feature.dueDate).toBeNull()
    expect(feature.completedAt).toBeNull()
    expect(feature.labels).toEqual([])
    expect(feature.order).toBe('a0')
    expect(feature.content).toBe('# My Spec\n\nSome content.')
    expect(feature.filePath).toBe(FIXTURE_PATH)
  })

  it('handles empty content', () => {
    const feature = parseSpeckitFile('', FIXTURE_PATH)
    expect(feature.status).toBe('todo')
    expect(feature.content).toBe('')
  })

  it('never returns null (always a Feature)', () => {
    const result = parseSpeckitFile('# Just a heading', FIXTURE_PATH)
    expect(result).not.toBeNull()
    expect(typeof result).toBe('object')
  })
})

// ---------------------------------------------------------------------------
// serializeSpeckitFeature
// ---------------------------------------------------------------------------

describe('serializeSpeckitFeature — existing frontmatter', () => {
  it('updates kanban keys while preserving non-kanban keys', () => {
    const original = `---
id: "my-feature-slug"
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
goal: "Build the spec"
acceptance: "Criteria here"
---
# My Spec
`
    const feature = parseSpeckitFile(original, FIXTURE_PATH)
    const updated = { ...feature, status: 'in-progress' as const, priority: 'high' as const }
    const result = serializeSpeckitFeature(updated, original)

    expect(result).toContain('goal: "Build the spec"')
    expect(result).toContain('acceptance: "Criteria here"')
    expect(result).toContain('status: "in-progress"')
    expect(result).toContain('priority: "high"')
    expect(result).toContain('# My Spec')
  })

  it('always writes epic: null regardless of feature.epic value', () => {
    const original = makeFrontmatterContent()
    const feature = { ...parseSpeckitFile(original, FIXTURE_PATH), epic: 'Some Epic' as string | null }
    const result = serializeSpeckitFeature(feature, original)
    expect(result).toContain('epic: null')
    expect(result).not.toContain('epic: "Some Epic"')
  })

  it('preserves body content after frontmatter', () => {
    const original = makeFrontmatterContent({}, '# Title\n\nDetailed spec body.')
    const feature = parseSpeckitFile(original, FIXTURE_PATH)
    const result = serializeSpeckitFeature(feature, original)
    expect(result).toContain('# Title\n\nDetailed spec body.')
  })

  it('appends missing kanban keys to the frontmatter', () => {
    const original = `---
status: "todo"
goal: "Something important"
---
# Body
`
    const feature = parseSpeckitFile(original, FIXTURE_PATH)
    const result = serializeSpeckitFeature(feature, original)

    expect(result).toContain('id:')
    expect(result).toContain('priority:')
    expect(result).toContain('order:')
    expect(result).toContain('goal: "Something important"')
  })

  it('writes null fields as literal null (not quoted)', () => {
    const original = makeFrontmatterContent()
    const feature = { ...parseSpeckitFile(original, FIXTURE_PATH), assignee: null, dueDate: null, completedAt: null }
    const result = serializeSpeckitFeature(feature, original)
    expect(result).toContain('assignee: null')
    expect(result).toContain('dueDate: null')
    expect(result).toContain('completedAt: null')
    expect(result).not.toContain('"null"')
  })

  it('serializes labels as a bracketed list of quoted strings', () => {
    const original = makeFrontmatterContent({ labels: '[]' })
    const feature = { ...parseSpeckitFile(original, FIXTURE_PATH), labels: ['alpha', 'beta'] }
    const result = serializeSpeckitFeature(feature, original)
    expect(result).toContain('labels: ["alpha", "beta"]')
  })
})

describe('serializeSpeckitFeature — first write (no frontmatter)', () => {
  it('injects a frontmatter block at the top', () => {
    const original = '# My Spec\n\nSome content.'
    const feature = parseSpeckitFile(original, FIXTURE_PATH)
    const result = serializeSpeckitFeature(feature, original)

    expect(result).toMatch(/^---\n/)
    expect(result).toContain('status: "todo"')
    expect(result).toContain('priority: "medium"')
    expect(result).toContain('epic: null')
    expect(result).toContain('order: "a0"')
    expect(result).toContain('# My Spec')
    expect(result).toContain('Some content.')
  })

  it('preserves the original markdown body after injected frontmatter', () => {
    const original = '# Title\n\nParagraph one.\n\nParagraph two.'
    const feature = parseSpeckitFile(original, FIXTURE_PATH)
    const result = serializeSpeckitFeature(feature, original)

    expect(result).toContain('Paragraph one.')
    expect(result).toContain('Paragraph two.')
  })
})

// ---------------------------------------------------------------------------
// Round-trip: parse → serialize → parse
// ---------------------------------------------------------------------------

describe('round-trip: parseSpeckitFile → serializeSpeckitFeature → parseSpeckitFile', () => {
  it('recovers all kanban fields faithfully', () => {
    const original = makeFrontmatterContent()
    const feature = parseSpeckitFile(original, FIXTURE_PATH)
    const serialized = serializeSpeckitFeature(feature, original)
    const recovered = parseSpeckitFile(serialized, FIXTURE_PATH)

    expect(recovered.id).toBe(feature.id)
    expect(recovered.status).toBe(feature.status)
    expect(recovered.priority).toBe(feature.priority)
    expect(recovered.assignee).toBe(feature.assignee)
    expect(recovered.epic).toBeNull()
    expect(recovered.dueDate).toBe(feature.dueDate)
    expect(recovered.created).toBe(feature.created)
    expect(recovered.modified).toBe(feature.modified)
    expect(recovered.completedAt).toBe(feature.completedAt)
    expect(recovered.labels).toEqual(feature.labels)
    expect(recovered.order).toBe(feature.order)
  })

  it('round-trips a first-write (no frontmatter) without data loss', () => {
    const original = '# My Spec\n\nContent here.'
    const feature = parseSpeckitFile(original, FIXTURE_PATH)
    const serialized = serializeSpeckitFeature(feature, original)
    const recovered = parseSpeckitFile(serialized, FIXTURE_PATH)

    expect(recovered.status).toBe('todo')
    expect(recovered.epic).toBeNull()
    expect(recovered.labels).toEqual([])
    expect(recovered.content).toBe('# My Spec\n\nContent here.')
  })

  it('preserves original file content below the frontmatter after round-trip', () => {
    const body = '# Spec Title\n\n## Overview\n\nDetailed description here.\n\n## Acceptance Criteria\n\n- [ ] Item one\n- [ ] Item two'
    const original = makeFrontmatterContent({}, body)
    const feature = parseSpeckitFile(original, FIXTURE_PATH)
    const serialized = serializeSpeckitFeature(feature, original)
    const recovered = parseSpeckitFile(serialized, FIXTURE_PATH)

    expect(recovered.content).toBe(body)
  })
})
