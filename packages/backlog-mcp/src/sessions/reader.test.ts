import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { encodeProjectDir, parseSession, readSessionsFromDir } from './reader'

const assistant = (content: string) =>
  `{"type":"assistant","timestamp":"2026-06-06T12:00:05.000Z","gitBranch":"story/x","cwd":"/Users/me/GitHub/kanban-vscode-extension","message":{"role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":1000,"output_tokens":200},"content":${content}}}`

describe('encodeProjectDir', () => {
  it('encodes a cwd to the lossy claude project-dir name', () => {
    expect(encodeProjectDir('/Users/me/GitHub/kanban-vscode-extension')).toBe('-Users-me-GitHub-kanban-vscode-extension')
    expect(encodeProjectDir('/a/b.c_d e')).toBe('-a-b-c-d-e')
  })
})

describe('parseSession', () => {
  it('extracts last activity, model, tokens, gitBranch, project', () => {
    const s = parseSession(
      assistant('[{"type":"tool_use","name":"Edit","input":{"file_path":"src/app.ts"}}]'),
      'uuid-1',
      { now: Date.parse('2026-06-06T12:00:06.000Z') }
    )
    expect(s.id).toBe('uuid-1')
    expect(s.lastActivity).toBe('Edit "app.ts"')
    expect(s.model).toBe('claude-opus-4-8')
    expect(s.tokens).toBe(1200)
    expect(s.gitBranch).toBe('story/x')
    expect(s.project).toBe('kanban-vscode-extension')
    expect(s.status).toBe('active') // within 2 min of last ts
  })

  it('detects needs-input from a trailing question', () => {
    expect(parseSession(assistant('[{"type":"text","text":"Which option do you prefer?"}]'), 'u').status).toBe('needs-input')
  })

  it('detects needs-input from an AskUserQuestion tool', () => {
    expect(parseSession(assistant('[{"type":"tool_use","name":"AskUserQuestion","input":{}}]'), 'u').status).toBe('needs-input')
  })

  it('goes idle when the last activity is old', () => {
    const s = parseSession(assistant('[{"type":"tool_use","name":"Bash","input":{"command":"pnpm test"}}]'), 'u', {
      now: Date.parse('2026-06-07T00:00:00.000Z')
    })
    expect(s.status).toBe('idle')
    expect(s.lastActivity).toBe('Bash "pnpm test"')
  })

  it('tolerates malformed lines and string content', () => {
    const text = 'not json\n{"type":"user","timestamp":"2026-06-06T12:00:00.000Z","message":{"role":"user","content":"hi"}}'
    expect(() => parseSession(text, 'u')).not.toThrow()
  })
})

describe('readSessionsFromDir', () => {
  it('reads every .jsonl in a dir (and ignores non-jsonl)', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pa-sess-'))
    try {
      await writeFile(join(tmp, 'a.jsonl'), assistant('[{"type":"text","text":"done."}]'))
      await writeFile(join(tmp, 'b.jsonl'), assistant('[{"type":"tool_use","name":"Read","input":{"file_path":"x.ts"}}]'))
      await writeFile(join(tmp, 'ignore.txt'), 'nope')
      const sessions = await readSessionsFromDir(tmp, { now: Date.parse('2026-06-06T12:00:06.000Z') })
      expect(sessions.map((s) => s.id).sort()).toEqual(['a', 'b'])
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
