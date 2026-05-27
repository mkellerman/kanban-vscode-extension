import { describe, it, expect } from 'vitest'
import { parseBmadFile, serializeBmadFeature } from '../../../src/shared/frameworks/bmad'

const FIXTURE_PATH = '/workspace/docs/stories/my-story-2026-05-27.md'
const EPIC_PATH = '/workspace/docs/stories/epics/auth-epic/my-story.md'

function makeFrontmatterContent(overrides: Record<string, string> = {}, body = '# My Story\n\nStory content.'): string {
  const fields: Record<string, string> = {
    name: '"My Story"',
    description: '"A BMAD story description"',
    stepsCompleted: '["step-1", "step-2"]',
    status: '"in-progress"',
    priority: '"high"',
    assignee: '"alice"',
    epic: '"auth-epic"',
    dueDate: '"2026-06-01"',
    created: '"2026-05-27T00:00:00.000Z"',
    modified: '"2026-05-27T12:00:00.000Z"',
    completedAt: 'null',
    labels: '["backend", "bmad"]',
    order: '"a1"',
    ...overrides
  }
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n${body}`
}

// ---------------------------------------------------------------------------
// Status derivation from stepsCompleted
// ---------------------------------------------------------------------------

describe('parseBmadFile — status derivation from stepsCompleted', () => {
  it('derives backlog when stepsCompleted is empty', () => {
    const content = makeFrontmatterContent({ stepsCompleted: '[]', status: '' })
    // status: '' won't produce a valid override, but we need to not have status key at all
    const fm = `---\nname: "My Story"\ndescription: "desc"\nstepsCompleted: []\n---\n# Body`
    expect(parseBmadFile(fm, FIXTURE_PATH).status).toBe('backlog')
  })

  it('derives in-progress when stepsCompleted is partially filled', () => {
    const fm = `---\nname: "My Story"\ndescription: "desc"\nstepsCompleted: ["step-1"]\n---\n# Body`
    expect(parseBmadFile(fm, FIXTURE_PATH).status).toBe('in-progress')
  })

  it('derives in-progress when stepsCompleted has multiple entries (full)', () => {
    const fm = `---\nname: "My Story"\ndescription: "desc"\nstepsCompleted: ["step-1", "step-2", "step-3"]\n---\n# Body`
    expect(parseBmadFile(fm, FIXTURE_PATH).status).toBe('in-progress')
  })

  it('derives backlog when stepsCompleted key is absent', () => {
    const fm = `---\nname: "My Story"\ndescription: "desc"\n---\n# Body`
    expect(parseBmadFile(fm, FIXTURE_PATH).status).toBe('backlog')
  })
})

// ---------------------------------------------------------------------------
// Explicit status overrides derivation
// ---------------------------------------------------------------------------

describe('parseBmadFile — explicit status overrides stepsCompleted derivation', () => {
  it('uses explicit status: done even when stepsCompleted is empty', () => {
    const fm = `---\nname: "My Story"\nstepsCompleted: []\nstatus: "done"\n---\n# Body`
    expect(parseBmadFile(fm, FIXTURE_PATH).status).toBe('done')
  })

  it('uses explicit status: backlog even when stepsCompleted is non-empty', () => {
    const fm = `---\nname: "My Story"\nstepsCompleted: ["step-1"]\nstatus: "backlog"\n---\n# Body`
    expect(parseBmadFile(fm, FIXTURE_PATH).status).toBe('backlog')
  })

  it('uses explicit status: review overriding in-progress derivation', () => {
    const fm = `---\nname: "My Story"\nstepsCompleted: ["step-1"]\nstatus: "review"\n---\n# Body`
    expect(parseBmadFile(fm, FIXTURE_PATH).status).toBe('review')
  })

  it('uses explicit status: todo overriding backlog derivation', () => {
    const fm = `---\nname: "My Story"\nstepsCompleted: []\nstatus: "todo"\n---\n# Body`
    expect(parseBmadFile(fm, FIXTURE_PATH).status).toBe('todo')
  })
})

// ---------------------------------------------------------------------------
// Epic from path vs frontmatter
// ---------------------------------------------------------------------------

describe('parseBmadFile — epic resolution', () => {
  it('extracts epic from epics/{epic}/ path segment', () => {
    const fm = `---\nname: "My Story"\nstepsCompleted: []\n---\n# Body`
    const feature = parseBmadFile(fm, EPIC_PATH)
    expect(feature.epic).toBe('auth-epic')
  })

  it('path epic takes precedence over frontmatter epic key', () => {
    const fm = `---\nname: "My Story"\nstepsCompleted: []\nepic: "fm-epic"\n---\n# Body`
    const feature = parseBmadFile(fm, EPIC_PATH)
    expect(feature.epic).toBe('auth-epic')
  })

  it('falls back to frontmatter epic when no path segment', () => {
    const fm = `---\nname: "My Story"\nstepsCompleted: []\nepic: "fm-epic"\n---\n# Body`
    const feature = parseBmadFile(fm, FIXTURE_PATH)
    expect(feature.epic).toBe('fm-epic')
  })

  it('returns null epic when neither path segment nor frontmatter key present', () => {
    const fm = `---\nname: "My Story"\nstepsCompleted: []\n---\n# Body`
    const feature = parseBmadFile(fm, FIXTURE_PATH)
    expect(feature.epic).toBeNull()
  })

  it('returns null epic when frontmatter epic is null and no path segment', () => {
    const fm = `---\nname: "My Story"\nstepsCompleted: []\nepic: null\n---\n# Body`
    const feature = parseBmadFile(fm, FIXTURE_PATH)
    expect(feature.epic).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseBmadFile — with frontmatter
// ---------------------------------------------------------------------------

describe('parseBmadFile — with frontmatter', () => {
  it('parses all kanban fields correctly', () => {
    const content = makeFrontmatterContent()
    const feature = parseBmadFile(content, FIXTURE_PATH)

    expect(feature.id).toBe('my-story-2026-05-27')
    expect(feature.status).toBe('in-progress')
    expect(feature.priority).toBe('high')
    expect(feature.assignee).toBe('alice')
    expect(feature.epic).toBe('auth-epic')
    expect(feature.dueDate).toBe('2026-06-01')
    expect(feature.created).toBe('2026-05-27T00:00:00.000Z')
    expect(feature.modified).toBe('2026-05-27T12:00:00.000Z')
    expect(feature.completedAt).toBeNull()
    expect(feature.labels).toEqual(['backend', 'bmad'])
    expect(feature.order).toBe('a1')
    expect(feature.content).toBe('# My Story\n\nStory content.')
    expect(feature.filePath).toBe(FIXTURE_PATH)
  })

  it('returns null for null-valued fields', () => {
    const content = makeFrontmatterContent({ assignee: 'null', dueDate: 'null', completedAt: 'null', epic: 'null' })
    const feature = parseBmadFile(content, FIXTURE_PATH)
    expect(feature.assignee).toBeNull()
    expect(feature.dueDate).toBeNull()
    expect(feature.completedAt).toBeNull()
    expect(feature.epic).toBeNull()
  })

  it('falls back to filename (without extension) as id when id is missing', () => {
    const content = `---\nname: "My Story"\nstepsCompleted: []\n---\n`
    expect(parseBmadFile(content, FIXTURE_PATH).id).toBe('my-story-2026-05-27')
  })

  it('defaults priority to "medium" when missing', () => {
    const content = `---\nname: "x"\nstepsCompleted: []\n---\n`
    expect(parseBmadFile(content, FIXTURE_PATH).priority).toBe('medium')
  })

  it('defaults order to "a0" when missing', () => {
    const content = `---\nname: "x"\nstepsCompleted: []\n---\n`
    expect(parseBmadFile(content, FIXTURE_PATH).order).toBe('a0')
  })

  it('preserves BMAD-specific keys without throwing', () => {
    const content = `---\nname: "x"\ndescription: "desc"\nstepsCompleted: ["step-1"]\nstatus: "in-progress"\n---\n# Body`
    const feature = parseBmadFile(content, FIXTURE_PATH)
    expect(feature.status).toBe('in-progress')
    expect(feature.content).toBe('# Body')
  })

  it('normalises CRLF line endings before parsing', () => {
    const content = makeFrontmatterContent().replace(/\n/g, '\r\n')
    const feature = parseBmadFile(content, FIXTURE_PATH)
    expect(feature.id).toBe('my-story-2026-05-27')
    expect(feature.status).toBe('in-progress')
  })
})

// ---------------------------------------------------------------------------
// parseBmadFile — without frontmatter
// ---------------------------------------------------------------------------

describe('parseBmadFile — without frontmatter', () => {
  it('returns Feature with backlog defaults for a plain markdown file', () => {
    const content = '# My Story\n\nSome content.'
    const feature = parseBmadFile(content, FIXTURE_PATH)

    expect(feature.id).toBe('my-story-2026-05-27')
    expect(feature.status).toBe('backlog')
    expect(feature.priority).toBe('medium')
    expect(feature.assignee).toBeNull()
    expect(feature.epic).toBeNull()
    expect(feature.dueDate).toBeNull()
    expect(feature.completedAt).toBeNull()
    expect(feature.labels).toEqual([])
    expect(feature.order).toBe('a0')
    expect(feature.content).toBe('# My Story\n\nSome content.')
    expect(feature.filePath).toBe(FIXTURE_PATH)
  })

  it('extracts epic from path even with no frontmatter', () => {
    const feature = parseBmadFile('# My Story', EPIC_PATH)
    expect(feature.epic).toBe('auth-epic')
  })

  it('handles empty content', () => {
    const feature = parseBmadFile('', FIXTURE_PATH)
    expect(feature.status).toBe('backlog')
    expect(feature.content).toBe('')
  })

  it('never returns null (always a Feature)', () => {
    const result = parseBmadFile('# Just a heading', FIXTURE_PATH)
    expect(result).not.toBeNull()
    expect(typeof result).toBe('object')
  })
})

// ---------------------------------------------------------------------------
// serializeBmadFeature — preserves BMAD-specific keys
// ---------------------------------------------------------------------------

describe('serializeBmadFeature — existing frontmatter', () => {
  it('updates kanban keys while preserving BMAD-specific keys', () => {
    const original = `---
name: "My Story"
description: "A BMAD story"
stepsCompleted: ["step-1"]
status: "in-progress"
priority: "medium"
assignee: null
epic: null
dueDate: null
created: "2026-05-27T00:00:00.000Z"
modified: "2026-05-27T00:00:00.000Z"
completedAt: null
labels: []
order: "a0"
---
# My Story
`
    const feature = parseBmadFile(original, FIXTURE_PATH)
    const updated = { ...feature, status: 'review' as const, priority: 'high' as const }
    const result = serializeBmadFeature(updated, original)

    expect(result).toContain('name: "My Story"')
    expect(result).toContain('description: "A BMAD story"')
    expect(result).toContain('stepsCompleted: ["step-1"]')
    expect(result).toContain('status: "review"')
    expect(result).toContain('priority: "high"')
    expect(result).toContain('# My Story')
  })

  it('preserves body content after frontmatter', () => {
    const original = makeFrontmatterContent({}, '# Title\n\nDetailed story body.')
    const feature = parseBmadFile(original, FIXTURE_PATH)
    const result = serializeBmadFeature(feature, original)
    expect(result).toContain('# Title\n\nDetailed story body.')
  })

  it('appends missing kanban keys to the frontmatter', () => {
    const original = `---
name: "My Story"
stepsCompleted: []
status: "backlog"
---
# Body
`
    const feature = parseBmadFile(original, FIXTURE_PATH)
    const result = serializeBmadFeature(feature, original)

    expect(result).toContain('id:')
    expect(result).toContain('priority:')
    expect(result).toContain('order:')
    expect(result).toContain('name: "My Story"')
    expect(result).toContain('stepsCompleted: []')
  })

  it('writes null fields as literal null (not quoted)', () => {
    const original = makeFrontmatterContent()
    const feature = { ...parseBmadFile(original, FIXTURE_PATH), assignee: null, dueDate: null, completedAt: null }
    const result = serializeBmadFeature(feature, original)
    expect(result).toContain('assignee: null')
    expect(result).toContain('dueDate: null')
    expect(result).toContain('completedAt: null')
    expect(result).not.toContain('"null"')
  })

  it('serializes labels as a bracketed list of quoted strings', () => {
    const original = makeFrontmatterContent({ labels: '[]' })
    const feature = { ...parseBmadFile(original, FIXTURE_PATH), labels: ['alpha', 'beta'] }
    const result = serializeBmadFeature(feature, original)
    expect(result).toContain('labels: ["alpha", "beta"]')
  })
})

describe('serializeBmadFeature — first write (no frontmatter)', () => {
  it('injects a frontmatter block at the top', () => {
    const original = '# My Story\n\nSome content.'
    const feature = parseBmadFile(original, FIXTURE_PATH)
    const result = serializeBmadFeature(feature, original)

    expect(result).toMatch(/^---\n/)
    expect(result).toContain('status: "backlog"')
    expect(result).toContain('priority: "medium"')
    expect(result).toContain('order: "a0"')
    expect(result).toContain('# My Story')
    expect(result).toContain('Some content.')
  })

  it('preserves the original markdown body after injected frontmatter', () => {
    const original = '# Title\n\nParagraph one.\n\nParagraph two.'
    const feature = parseBmadFile(original, FIXTURE_PATH)
    const result = serializeBmadFeature(feature, original)

    expect(result).toContain('Paragraph one.')
    expect(result).toContain('Paragraph two.')
  })
})

// ---------------------------------------------------------------------------
// Round-trip: parse → serialize → parse
// ---------------------------------------------------------------------------

describe('round-trip: parseBmadFile → serializeBmadFeature → parseBmadFile', () => {
  it('recovers all kanban fields faithfully', () => {
    const original = makeFrontmatterContent()
    const feature = parseBmadFile(original, FIXTURE_PATH)
    const serialized = serializeBmadFeature(feature, original)
    const recovered = parseBmadFile(serialized, FIXTURE_PATH)

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
    const original = '# My Story\n\nContent here.'
    const feature = parseBmadFile(original, FIXTURE_PATH)
    const serialized = serializeBmadFeature(feature, original)
    const recovered = parseBmadFile(serialized, FIXTURE_PATH)

    expect(recovered.status).toBe('backlog')
    expect(recovered.labels).toEqual([])
    expect(recovered.content).toBe('# My Story\n\nContent here.')
  })

  it('preserves BMAD keys across round-trip', () => {
    const original = `---
name: "My Story"
description: "A BMAD story"
stepsCompleted: ["step-1", "step-2"]
status: "in-progress"
priority: "medium"
assignee: null
epic: null
dueDate: null
created: "2026-05-27T00:00:00.000Z"
modified: "2026-05-27T00:00:00.000Z"
completedAt: null
labels: []
order: "a0"
---
# Body
`
    const feature = parseBmadFile(original, FIXTURE_PATH)
    const serialized = serializeBmadFeature(feature, original)

    expect(serialized).toContain('name: "My Story"')
    expect(serialized).toContain('description: "A BMAD story"')
    expect(serialized).toContain('stepsCompleted: ["step-1", "step-2"]')
  })
})
