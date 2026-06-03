import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { KanbanColumn } from '../../../src/shared/types'
import type { PromptContext } from '../../../src/extension/ai/promptBuilder'

// ---------------------------------------------------------------------------
// Mock the fs module so no real filesystem is accessed
// ---------------------------------------------------------------------------
vi.mock('fs')

import * as fs from 'fs'

// ---------------------------------------------------------------------------
// Import subject after mocking
// ---------------------------------------------------------------------------
import { buildPrompt } from '../../../src/extension/ai/promptBuilder'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXTENSION_ROOT = '/ext'
const WORKSPACE_ROOT = '/workspace'

const baseCtx: PromptContext = {
  title: 'My Feature',
  status: 'todo',
  priority: 'high',
  labels: [],
  content: 'Some feature content',
  filePath: '/workspace/.kanban/features/my-feature.md'
}

const todoColumn: KanbanColumn = { id: 'todo', name: 'To Do', color: '#3b82f6' }
const reviewColumn: KanbanColumn = { id: 'review', name: 'Review', color: '#8b5cf6' }
const doneColumn: KanbanColumn = { id: 'done', name: 'Done', color: '#22c55e' }
const inProgressColumn: KanbanColumn = { id: 'in-progress', name: 'In Progress', color: '#f59e0b' }
const backlogColumn: KanbanColumn = { id: 'backlog', name: 'Backlog', color: '#6b7280' }

function makeFsMock(opts: {
  instructionsDirExists?: boolean
  instructionsDirRealPath?: string
  localContent?: string
  bundledContent?: string
} = {}) {
  const {
    instructionsDirExists = false,
    instructionsDirRealPath,
    localContent,
    bundledContent
  } = opts

  vi.mocked(fs.realpathSync).mockImplementation((p: fs.PathLike) => {
    const str = String(p)
    if (instructionsDirRealPath && str === `${WORKSPACE_ROOT}/.kanban/instructions`) {
      return instructionsDirRealPath
    }
    // For the candidate file path, return as-is (same directory)
    if (instructionsDirExists && str.endsWith('.md')) {
      return str
    }
    if (instructionsDirRealPath) {
      return str
    }
    throw new Error('ENOENT')
  })

  vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike | number, _options?: unknown) => {
    const str = String(p)
    if (str.includes('.kanban/instructions') && localContent !== undefined) {
      return localContent
    }
    if (str.includes('/prompts/') && bundledContent !== undefined) {
      return bundledContent
    }
    throw new Error('ENOENT')
  })
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ---------------------------------------------------------------------------
// Variable substitution tests
// ---------------------------------------------------------------------------

describe('buildPrompt — variable substitution', () => {
  it('substitutes all seven variables in a settings template', () => {
    const template = '{{title}} {{priority}} {{status}} {{columnName}} {{labels}} {{description}} {{filePath}}'
    const ctx: PromptContext = {
      title: 'My Feature',
      status: 'todo',
      priority: 'high',
      labels: ['bug', 'urgent'],
      content: 'Short description',
      filePath: '/workspace/feat.md'
    }
    makeFsMock() // no local file, no bundled file
    const result = buildPrompt(ctx, todoColumn, EXTENSION_ROOT, null, template)
    expect(result).toContain('My Feature')
    expect(result).toContain('high')
    expect(result).toContain('todo')
    expect(result).toContain('To Do')
    expect(result).toContain(' [bug, urgent]')
    expect(result).toContain('Short description')
    expect(result).toContain('/workspace/feat.md')
    // filePath present in template → no auto-append
    expect(result).not.toContain('See full details in:')
  })

  it('appends filePath line when {{filePath}} is absent from template', () => {
    const template = 'Do something with: "{{title}}"'
    makeFsMock()
    const result = buildPrompt(baseCtx, todoColumn, EXTENSION_ROOT, null, template)
    expect(result).toContain('\nSee full details in: /workspace/.kanban/features/my-feature.md')
  })

  it('substitutes {{filePath}} in place when present in template (no extra line appended)', () => {
    const template = 'See file at {{filePath}} for details'
    makeFsMock()
    const result = buildPrompt(baseCtx, todoColumn, EXTENSION_ROOT, null, template)
    expect(result).toContain('See file at /workspace/.kanban/features/my-feature.md for details')
    expect(result).not.toContain('See full details in:')
  })

  it('renders {{labels}} as empty string when labels array is empty', () => {
    const template = 'Do "{{title}}"{{labels}}.'
    makeFsMock()
    const ctx = { ...baseCtx, labels: [] }
    const result = buildPrompt(ctx, todoColumn, EXTENSION_ROOT, null, template)
    expect(result).toContain('Do "My Feature".')
    expect(result).not.toContain('[')
  })

  it('renders {{labels}} with brackets and comma-separated values when labels present', () => {
    const template = '"{{title}}"{{labels}}'
    makeFsMock()
    const ctx = { ...baseCtx, labels: ['a', 'b'] }
    const result = buildPrompt(ctx, todoColumn, EXTENSION_ROOT, null, template)
    expect(result).toContain('"My Feature" [a, b]')
  })

  it('truncates {{description}} at 200 chars with ellipsis', () => {
    const longContent = 'x'.repeat(300)
    const template = '{{description}}'
    makeFsMock()
    const ctx = { ...baseCtx, content: longContent }
    const result = buildPrompt(ctx, todoColumn, EXTENSION_ROOT, null, template)
    // The substituted description should be max 203 chars (200 + '...')
    const desc = result.replace('\nSee full details in: ' + baseCtx.filePath, '')
    expect(desc).toHaveLength(203)
    expect(desc.endsWith('...')).toBe(true)
  })

  it('does not truncate {{description}} when content is exactly 200 chars', () => {
    const exactContent = 'y'.repeat(200)
    const template = '{{description}}'
    makeFsMock()
    const ctx = { ...baseCtx, content: exactContent }
    const result = buildPrompt(ctx, todoColumn, EXTENSION_ROOT, null, template)
    const desc = result.replace('\nSee full details in: ' + baseCtx.filePath, '')
    expect(desc).toBe('y'.repeat(200))
  })

  it('renders {{priority}} as "critical" unchanged', () => {
    const template = 'Priority: {{priority}}'
    makeFsMock()
    const ctx = { ...baseCtx, priority: 'critical' }
    const result = buildPrompt(ctx, todoColumn, EXTENSION_ROOT, null, template)
    expect(result).toContain('Priority: critical')
  })

  it('$& in a variable value appears literally — no back-reference expansion', () => {
    // In old sequential String.replace, `$&` in a replacement string would expand
    // to the matched text (the full {{title}} pattern). Single-pass function replacer prevents this.
    const template = 'Title: {{title}} {{filePath}}'
    makeFsMock()
    const ctx = { ...baseCtx, title: 'Fix $& regression' }
    const result = buildPrompt(ctx, todoColumn, EXTENSION_ROOT, null, template)
    expect(result).toContain('Title: Fix $& regression')
    // Must not expand $& to the regex match text '{{title}}'
    expect(result).not.toContain('{{title}}')
  })

  it('$1 in a variable value appears literally — no back-reference expansion', () => {
    const template = 'Title: {{title}} {{filePath}}'
    makeFsMock()
    const ctx = { ...baseCtx, title: 'Task $1: something' }
    const result = buildPrompt(ctx, todoColumn, EXTENSION_ROOT, null, template)
    expect(result).toContain('Title: Task $1: something')
  })

  it("title containing {{description}} is not expanded (no variable cascading)", () => {
    // With sequential .replace calls, expanding {{title}} first would inject '{{description}}'
    // into the string, which would then be expanded by the next pass. Single-pass prevents this.
    const template = 'Title: {{title}}. Desc: {{description}} {{filePath}}'
    makeFsMock()
    const ctx = { ...baseCtx, title: 'My {{description}} feature', content: 'real description' }
    const result = buildPrompt(ctx, todoColumn, EXTENSION_ROOT, null, template)
    // The title should appear verbatim; {{description}} inside it must NOT be expanded
    expect(result).toContain('Title: My {{description}} feature')
    // The real {{description}} placeholder should expand to the content
    expect(result).toContain('Desc: real description')
  })

  it('description containing {{title}} is not expanded (no variable cascading)', () => {
    const template = 'Title: {{title}}. Desc: {{description}} {{filePath}}'
    makeFsMock()
    const ctx = { ...baseCtx, title: 'Actual Title', content: 'See {{title}} for context' }
    const result = buildPrompt(ctx, todoColumn, EXTENSION_ROOT, null, template)
    // description value should appear verbatim without expanding {{title}}
    expect(result).toContain('Desc: See {{title}} for context')
    expect(result).toContain('Title: Actual Title')
  })
})

// ---------------------------------------------------------------------------
// Template size cap tests
// ---------------------------------------------------------------------------

describe('buildPrompt — template size cap (16 KB)', () => {
  const MAX = 16384

  it('local file template longer than 16 KB is truncated to 16384 chars', () => {
    const oversized = 'A'.repeat(MAX + 1000) + ' {{title}} {{filePath}}'
    vi.mocked(fs.realpathSync).mockImplementation((p: fs.PathLike) => String(p))
    vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike | number, _opts?: unknown) => {
      const str = String(p)
      if (str.includes('.kanban/instructions')) return oversized
      throw new Error('ENOENT')
    })

    const result = buildPrompt(baseCtx, todoColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    // Result should be based on the first MAX chars of the template, so the
    // trailing ' {{title}} {{filePath}}' (beyond position 16384) is dropped
    expect(result.length).toBeLessThan(oversized.length)
    // Title should NOT appear because the truncation cut off the {{title}} placeholder
    expect(result).not.toContain('My Feature')
    // auto-append should fire because {{filePath}} was also truncated away
    expect(result).toContain('\nSee full details in:')
  })

  it('settings template longer than 16 KB is truncated to 16384 chars', () => {
    const oversized = 'B'.repeat(MAX + 500) + ' {{title}} {{filePath}}'
    makeFsMock()  // no local file

    const result = buildPrompt(baseCtx, todoColumn, EXTENSION_ROOT, null, oversized)
    expect(result.length).toBeLessThan(oversized.length)
    // Title and filePath placeholders are beyond the cap → not substituted
    expect(result).not.toContain('My Feature')
    expect(result).toContain('\nSee full details in:')
  })

  it('bundled prompt is NOT capped (no truncation applied)', () => {
    // Bundled prompts are extension-controlled; size cap must not apply
    const normalBundled = 'Bundled: {{title}} {{filePath}}'
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike | number, _opts?: unknown) => {
      if (String(p).includes('/prompts/')) return normalBundled
      throw new Error('ENOENT')
    })

    const result = buildPrompt(baseCtx, todoColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(result).toContain('Bundled: My Feature')
    expect(result).not.toContain('See full details in:')
  })
})

// ---------------------------------------------------------------------------
// Priority chain tests
// ---------------------------------------------------------------------------

describe('buildPrompt — resolution chain', () => {
  it('Level 1: local file wins over settings template', () => {
    vi.mocked(fs.realpathSync).mockImplementation((p: fs.PathLike) => String(p))
    vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike | number, _opts?: unknown) => {
      const str = String(p)
      if (str.includes('.kanban/instructions')) return 'Local: {{title}}'
      throw new Error('ENOENT')
    })

    const result = buildPrompt(baseCtx, todoColumn, EXTENSION_ROOT, WORKSPACE_ROOT, 'Settings: {{title}}')
    expect(result).toContain('Local: My Feature')
    expect(result).not.toContain('Settings:')
  })

  it('Level 2: settings template wins over bundled default when no local file', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike | number, _opts?: unknown) => {
      const str = String(p)
      if (str.includes('/prompts/')) return 'Bundled: {{title}}'
      throw new Error('ENOENT')
    })

    const result = buildPrompt(baseCtx, todoColumn, EXTENSION_ROOT, WORKSPACE_ROOT, 'Settings: {{title}}')
    expect(result).toContain('Settings: My Feature')
    expect(result).not.toContain('Bundled:')
  })

  it('Level 3: bundled default used when no local file and no settings template', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike | number, _opts?: unknown) => {
      const str = String(p)
      if (str.includes('/prompts/todo.md')) return 'Bundled todo: {{title}}'
      throw new Error('ENOENT')
    })

    const result = buildPrompt(baseCtx, todoColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(result).toContain('Bundled todo: My Feature')
  })

  it('Level 4: generic fallback used when no local file, no settings, no bundled file', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })

    const result = buildPrompt(baseCtx, todoColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(result).toContain('Implement this feature: "My Feature"')
    expect(result).toContain('high priority')
    // fallback now includes {{filePath}} so no auto-append
    expect(result).toContain(baseCtx.filePath)
    expect(result).not.toContain('See full details in:')
  })

  it('falls through to bundled/fallback for unknown column ID when no files exist', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })

    const unknownColumn: KanbanColumn = { id: 'unknown-col', name: 'Unknown', color: '' }
    const result = buildPrompt(baseCtx, unknownColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(result).toContain('Implement this feature: "My Feature"')
  })

  it('whitespace-only settingsTemplate falls through to bundled/fallback', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })

    const result = buildPrompt(baseCtx, todoColumn, EXTENSION_ROOT, WORKSPACE_ROOT, '   ')
    expect(result).toContain('Implement this feature: "My Feature"')
  })

  it('empty string settingsTemplate falls through to bundled/fallback', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })

    const result = buildPrompt(baseCtx, todoColumn, EXTENSION_ROOT, WORKSPACE_ROOT, '')
    expect(result).toContain('Implement this feature: "My Feature"')
  })

  it('undefined settingsTemplate falls through to bundled/fallback', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })

    const result = buildPrompt(baseCtx, todoColumn, EXTENSION_ROOT, WORKSPACE_ROOT, undefined)
    expect(result).toContain('Implement this feature: "My Feature"')
  })

  it('whitespace-only bundled file falls through to fallback', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike | number, _opts?: unknown) => {
      if (String(p).includes('/prompts/')) return '   \n   '
      throw new Error('ENOENT')
    })

    const result = buildPrompt(baseCtx, todoColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(result).toContain('Implement this feature: "My Feature"')
  })
})

// ---------------------------------------------------------------------------
// workspaceRoot: null skips local file step
// ---------------------------------------------------------------------------

describe('buildPrompt — workspaceRoot: null', () => {
  it('skips local file lookup and uses settings template', () => {
    // realpathSync should never be called when workspaceRoot is null
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('should not be called') })
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })

    const result = buildPrompt(baseCtx, todoColumn, EXTENSION_ROOT, null, 'Settings: {{title}}')
    expect(result).toContain('Settings: My Feature')
    expect(vi.mocked(fs.realpathSync)).not.toHaveBeenCalled()
  })

  it('skips local file lookup and falls through to bundled default', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('should not be called') })
    vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike | number, _opts?: unknown) => {
      if (String(p).includes('/prompts/todo.md')) return 'Bundled: {{title}}'
      throw new Error('ENOENT')
    })

    const result = buildPrompt(baseCtx, todoColumn, EXTENSION_ROOT, null)
    expect(result).toContain('Bundled: My Feature')
    expect(vi.mocked(fs.realpathSync)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Column ID character validation
// ---------------------------------------------------------------------------

describe('buildPrompt — column ID validation', () => {
  it('in-progress passes validation and attempts local file lookup', () => {
    // instructionsDir resolves so the candidate path is attempted, but the file is absent
    vi.mocked(fs.realpathSync).mockImplementation((p: fs.PathLike) => {
      const str = String(p)
      // workspaceRoot and instructionsDir both resolve to themselves
      if (str === WORKSPACE_ROOT || str.endsWith('instructions')) return str
      throw new Error('ENOENT')  // candidate absent
    })
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })

    buildPrompt(baseCtx, inProgressColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    // candidate path with in-progress.md was passed to realpathSync
    expect(vi.mocked(fs.realpathSync).mock.calls.some(c => String(c[0]).includes('in-progress'))).toBe(true)
  })

  it('../secret column ID skips local file lookup entirely', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('should not be called') })
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })

    const badColumn: KanbanColumn = { id: '../secret', name: 'Bad', color: '' }
    buildPrompt(baseCtx, badColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(vi.mocked(fs.realpathSync)).not.toHaveBeenCalled()
  })

  it('foo\\\\bar column ID skips local file lookup', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('should not be called') })
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })

    const badColumn: KanbanColumn = { id: 'foo\\bar', name: 'Bad', color: '' }
    buildPrompt(baseCtx, badColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(vi.mocked(fs.realpathSync)).not.toHaveBeenCalled()
  })

  it('my:column ID skips local file lookup', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('should not be called') })
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })

    const badColumn: KanbanColumn = { id: 'my:column', name: 'Bad', color: '' }
    buildPrompt(baseCtx, badColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(vi.mocked(fs.realpathSync)).not.toHaveBeenCalled()
  })

  it('foo bar column ID (with space) skips local file lookup', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('should not be called') })
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT') })

    const badColumn: KanbanColumn = { id: 'foo bar', name: 'Bad', color: '' }
    buildPrompt(baseCtx, badColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(vi.mocked(fs.realpathSync)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Bundled prompt files (smoke tests for known column IDs)
// ---------------------------------------------------------------------------

describe('buildPrompt — bundled prompt content shape', () => {
  function bundledOnly(filename: string, content: string) {
    vi.mocked(fs.realpathSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike | number, _opts?: unknown) => {
      if (String(p).endsWith(`/${filename}`)) return content
      throw new Error('ENOENT')
    })
  }

  it('backlog bundled prompt uses research language', () => {
    bundledOnly('backlog.md', 'Research and plan an approach for: "{{title}}" ({{priority}} priority){{labels}}. {{description}} {{filePath}}')
    const result = buildPrompt({ ...baseCtx, status: 'backlog' }, backlogColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(result).toContain('Research and plan an approach for: "My Feature"')
    expect(result).not.toContain('See full details in:')
  })

  it('review bundled prompt uses review language', () => {
    bundledOnly('review.md', 'Review this implementation for correctness, edge cases, and code quality: "{{title}}"{{labels}}. {{description}} {{filePath}}')
    const result = buildPrompt({ ...baseCtx, status: 'review' }, reviewColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(result).toContain('Review this implementation for correctness')
    expect(result).not.toContain('See full details in:')
  })

  it('done bundled prompt uses tests/docs language', () => {
    bundledOnly('done.md', 'Write tests and documentation for: "{{title}}"{{labels}}. {{description}} {{filePath}}')
    const result = buildPrompt({ ...baseCtx, status: 'done' }, doneColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(result).toContain('Write tests and documentation for: "My Feature"')
    expect(result).not.toContain('See full details in:')
  })

  it('in-progress bundled prompt mentions continuing work', () => {
    bundledOnly('in-progress.md', 'Continue implementing: "{{title}}" ({{priority}} priority){{labels}}. Pick up where work left off. {{description}} {{filePath}}')
    const result = buildPrompt({ ...baseCtx, status: 'in-progress' }, inProgressColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    expect(result).toContain('Continue implementing')
    expect(result).toContain('Pick up where work left off')
    expect(result).not.toContain('See full details in:')
  })
})

// ---------------------------------------------------------------------------
// Security: symlink and path traversal guards
// ---------------------------------------------------------------------------

describe('buildPrompt — symlink and traversal guards', () => {
  // Stage 1 (path.relative pre-check) is belt-and-suspenders: with SAFE_ID
  // restricting column IDs to [a-zA-Z0-9_\-.], path.resolve can never produce
  // a candidate outside instructionsDir. Stage 1 cannot be triggered after
  // Stage 0. The existing 'in-progress passes validation' test verifies Stage 1
  // does not falsely reject a valid ID (realpathSync is reached).
  //
  // Stage 2 (realpathSync re-check after symlink resolution) IS testable via
  // mocks: configure realpathSync to return a realpath outside instructionsDir
  // for the candidate file, simulating a symlink escape.

  it('symlink whose realpath escapes .kanban/instructions is rejected silently (Stage 2)', () => {
    vi.mocked(fs.realpathSync).mockImplementation((p: fs.PathLike) => {
      const str = String(p)
      if (str === WORKSPACE_ROOT) return WORKSPACE_ROOT
      if (str.endsWith('instructions')) return `${WORKSPACE_ROOT}/.kanban/instructions`
      // Simulate symlink: candidate resolves to a path outside instructions dir
      return '/etc/passwd'
    })
    vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike | number, _opts?: unknown) => {
      if (String(p).includes('/prompts/')) return 'Bundled: {{title}}'
      throw new Error('ENOENT')
    })

    const result = buildPrompt(baseCtx, inProgressColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    // readFileSync must NOT have been called with the escaped realpath
    expect(vi.mocked(fs.readFileSync).mock.calls.some(c => String(c[0]).includes('/etc/passwd'))).toBe(false)
    // Falls through to bundled default
    expect(result).toContain('Bundled: My Feature')
  })

  it('symlink on .kanban/instructions itself pointing outside workspaceRoot is rejected (Stage 2a)', () => {
    // .kanban/instructions is itself a symlink pointing to /etc (outside workspaceRoot)
    vi.mocked(fs.realpathSync).mockImplementation((p: fs.PathLike) => {
      const str = String(p)
      if (str === WORKSPACE_ROOT) return WORKSPACE_ROOT
      if (str.endsWith('instructions')) return '/etc'  // symlink escape
      return str
    })
    vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathLike | number, _opts?: unknown) => {
      if (String(p).includes('/prompts/')) return 'Bundled: {{title}}'
      throw new Error('ENOENT')
    })

    const result = buildPrompt(baseCtx, inProgressColumn, EXTENSION_ROOT, WORKSPACE_ROOT)
    // readFileSync must NOT have been called for a file under /etc
    expect(vi.mocked(fs.readFileSync).mock.calls.some(c => String(c[0]).startsWith('/etc/'))).toBe(false)
    // Falls through to bundled default
    expect(result).toContain('Bundled: My Feature')
  })
})
