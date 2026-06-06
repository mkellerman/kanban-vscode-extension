/**
 * Sessions domain — normalize Claude/Codex JSONL transcripts into `Session`s.
 *
 * Defensive line-by-line parser (handles content polymorphism, malformed lines,
 * sidechains). Captures `model` + token `usage` (which claudine omits). claudine
 * enrichment is optional and layered on top later; this is the always-available reader.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import type { Session, SessionStatus } from '../contract'

let sessionsDir = join(homedir(), '.claude', 'projects')
/** Override the Claude projects dir (default ~/.claude/projects) — for tests/config. */
export function setSessionsDir(dir: string): void { sessionsDir = dir }
export function getSessionsDir(): string { return sessionsDir }

/** Encode a cwd to Claude's project-dir name. LOSSY (forward-only): never reverse it. */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[/\\:._ ]/g, '-')
}

const ACTIVE_WINDOW_MS = 2 * 60 * 1000

function formatToolUse(name: string, input: Record<string, unknown> | undefined): string {
  if (input) {
    const f = input.file_path ?? input.path
    if (typeof f === 'string') return `${name} "${basename(f)}"`
    if (name === 'Bash' && typeof input.command === 'string') return `Bash "${(input.command as string).slice(0, 40)}"`
    if (typeof input.pattern === 'string') return `${name} "${input.pattern}"`
  }
  return name
}

function normalizeContent(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (Array.isArray(content)) return content.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
  if (content && typeof content === 'object') return [content as Record<string, unknown>]
  return []
}

export interface ParseOpts { now?: number }

/** Parse one JSONL transcript into a normalized Session. `id` = the file's uuid. */
export function parseSession(text: string, id: string, opts: ParseOpts = {}): Session {
  const now = opts.now ?? Date.now()
  let lastTs: string | null = null
  let model: string | null = null
  let tokens = 0
  let gitBranch: string | null = null
  let cwd: string | null = null
  let lastActivity: string | null = null
  let needsInput = false

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let entry: Record<string, unknown>
    try { entry = JSON.parse(line) } catch { continue }

    if (typeof entry.timestamp === 'string') lastTs = entry.timestamp
    if (typeof entry.gitBranch === 'string' && entry.gitBranch !== 'HEAD') gitBranch = entry.gitBranch
    if (typeof entry.cwd === 'string') cwd = entry.cwd
    if (entry.isSidechain === true) continue // subagent chatter doesn't drive the main status

    const msg = entry.message as Record<string, unknown> | undefined
    if (!msg || typeof msg !== 'object') continue
    if (typeof msg.model === 'string') model = msg.model
    const usage = msg.usage as Record<string, unknown> | undefined
    if (usage) tokens += (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0)

    const blocks = normalizeContent(msg.content)
    if (msg.role === 'assistant') {
      const tool = [...blocks].reverse().find((b) => b.type === 'tool_use')
      if (tool && typeof tool.name === 'string') lastActivity = formatToolUse(tool.name, tool.input as Record<string, unknown>)
      const hasQuestionTool = blocks.some((b) => b.type === 'tool_use' && (b.name === 'AskUserQuestion' || b.name === 'ExitPlanMode'))
      const lastText = [...blocks].reverse().find((b) => b.type === 'text')?.text as string | undefined
      needsInput = hasQuestionTool || (typeof lastText === 'string' && lastText.trim().endsWith('?'))
    } else if (msg.role === 'user') {
      needsInput = false // a user reply clears needs-input
    }
  }

  let status: SessionStatus
  if (needsInput) status = 'needs-input'
  else if (lastTs && now - new Date(lastTs).getTime() < ACTIVE_WINDOW_MS) status = 'active'
  else status = 'idle'

  return {
    id,
    project: cwd ? basename(cwd) : 'unknown',
    status,
    lastActivity,
    gitBranch,
    worktree: cwd && cwd.includes('worktree') ? cwd : null,
    model,
    tokens: tokens || null,
    workItemId: null // linking (branch/worktree + launch-capture) is a later concern
  }
}

/** Read every .jsonl transcript in a single dir. */
export async function readSessionsFromDir(dir: string, opts: ParseOpts = {}): Promise<Session[]> {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return [] }
  const out: Session[] = []
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.jsonl')) {
      try { out.push(parseSession(await readFile(join(dir, e.name), 'utf8'), e.name.replace(/\.jsonl$/, ''), opts)) } catch { /* skip bad file */ }
    }
  }
  return out
}

/** Project scope — sessions for one workspace root. */
export async function readProjectSessions(boardRoot: string, opts: ParseOpts = {}): Promise<Session[]> {
  return readSessionsFromDir(join(sessionsDir, encodeProjectDir(boardRoot)), opts)
}

/** User scope — sessions across all projects. */
export async function readAllSessions(opts: ParseOpts = {}): Promise<Session[]> {
  let dirs
  try { dirs = await readdir(sessionsDir, { withFileTypes: true }) } catch { return [] }
  const out: Session[] = []
  for (const d of dirs) {
    if (d.isDirectory()) out.push(...(await readSessionsFromDir(join(sessionsDir, d.name), opts)))
  }
  return out
}
