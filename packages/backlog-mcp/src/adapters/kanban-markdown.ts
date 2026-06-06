/**
 * kanban-markdown adapter — the original LachyFS extension's format (and our own
 * legacy flat files): one `.md` per card in a features dir, with a `done/` subfolder.
 * Read-only (foreign framework); writing would require byte-for-byte serializer parity.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkItem, NormStatus, Priority } from '../contract'
import type { FrameworkAdapter, AdapterContext } from './types'
import { splitFrontmatter, titleFromBody, acceptanceCriteria } from './markdown'

const NS = 'kanban-markdown'
const id = (name: string) => `${NS}:${name}`
const CANDIDATE_DIRS = ['.kanban/features', '.devtool/features']

async function featuresDirs(root: string): Promise<string[]> {
  const out: string[] = []
  for (const d of CANDIDATE_DIRS) {
    const p = join(root, d)
    try {
      if ((await stat(p)).isDirectory()) out.push(p)
    } catch {
      /* not present */
    }
  }
  return out
}

/** Flat `.md` card files (top-level + `done/`); folder-format stories are the native adapter's. */
async function flatCardFiles(dir: string): Promise<{ name: string; path: string; done: boolean }[]> {
  const out: { name: string; path: string; done: boolean }[] = []
  for (const [base, done] of [[dir, false], [join(dir, 'done'), true]] as const) {
    let entries
    try {
      entries = await readdir(base, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.md')) {
        out.push({ name: e.name.replace(/\.md$/, ''), path: join(base, e.name), done })
      }
    }
  }
  return out
}

function toWorkItem(name: string, text: string, path: string, inDone: boolean): WorkItem | null {
  if (!text.trimStart().startsWith('---')) return null // no frontmatter → not a card (upstream behavior)
  const { fm, body } = splitFrontmatter(text)
  const itemId = id(String(fm.id ?? name))
  const status = (inDone ? 'done' : ((fm.status as string) || 'backlog')) as NormStatus
  return {
    id: itemId,
    source: { framework: NS, path },
    type: 'feature',
    title: titleFromBody(body, name),
    status,
    priority: (fm.priority as Priority) ?? null,
    parent: fm.epic ? id(String(fm.epic)) : null,
    children: [],
    dependsOn: [], // kanban-markdown has no dependency concept
    labels: Array.isArray(fm.labels) ? (fm.labels as unknown[]).map(String) : [],
    estimate: null,
    acceptanceCriteria: acceptanceCriteria(body),
    bodyRef: `${itemId}#body`
  }
}

export const kanbanMarkdownAdapter: FrameworkAdapter = {
  name: NS,

  async detect(ctx: AdapterContext) {
    for (const dir of await featuresDirs(ctx.root)) {
      if ((await flatCardFiles(dir)).length > 0) return true
    }
    return false
  },

  async listItems(ctx: AdapterContext) {
    const items: WorkItem[] = []
    for (const dir of await featuresDirs(ctx.root)) {
      for (const f of await flatCardFiles(dir)) {
        const wi = toWorkItem(f.name, await readFile(f.path, 'utf8'), f.path, f.done)
        if (wi) items.push(wi)
      }
    }
    return items
  },

  async getBody(ctx: AdapterContext, itemId: string) {
    for (const dir of await featuresDirs(ctx.root)) {
      for (const f of await flatCardFiles(dir)) {
        const text = await readFile(f.path, 'utf8')
        const { fm, body } = splitFrontmatter(text)
        if (id(String(fm.id ?? f.name)) === itemId) return body.trim()
      }
    }
    return ''
  }
  // read-only: no setStatus
}
