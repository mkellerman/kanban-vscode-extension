import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { WorkItem, NormStatus, Priority } from '../contract'
import type { FrameworkAdapter, AdapterContext } from './types'

const NS = 'native'
const id = (folder: string) => `${NS}:${folder}`
const stripNs = (x: string) => (x.startsWith(`${NS}:`) ? x.slice(NS.length + 1) : x)

const featuresDir = (root: string) => join(root, '.kanban', 'features')

function splitFrontmatter(text: string): { fm: Record<string, unknown>; body: string } {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { fm: {}, body: text }
  const parsed = parse(m[1]) as unknown
  return { fm: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}, body: m[2] ?? '' }
}

function acceptanceCriteria(body: string): string[] {
  const section = body.split(/^##\s+/m).find((s) => /^acceptance criteria/i.test(s))
  if (!section) return []
  return [...section.matchAll(/^- \[[ xX]\]\s+(.*)$/gm)].map((x) => x[1].trim())
}

function toWorkItem(folder: string, text: string, path: string): WorkItem {
  const { fm, body } = splitFrontmatter(text)
  const deps = Array.isArray(fm.dependsOn) ? (fm.dependsOn as unknown[]).map(String) : []
  const titleMatch = body.match(/^#\s+(.+)$/m)
  return {
    id: id(folder),
    source: { framework: NS, path },
    type: 'story',
    title: titleMatch ? titleMatch[1].trim() : folder,
    status: (fm.status as NormStatus) ?? 'backlog',
    priority: (fm.priority as Priority) ?? null,
    parent: fm.epic ? id(String(fm.epic)) : null,
    children: [],
    dependsOn: deps.map((d) => id(stripNs(d))),
    labels: Array.isArray(fm.labels) ? (fm.labels as unknown[]).map(String) : [],
    estimate: null,
    acceptanceCriteria: acceptanceCriteria(body),
    bodyRef: `${id(folder)}#body`
  }
}

async function listStoryFolders(dir: string): Promise<{ folder: string; path: string }[]> {
  const out: { folder: string; path: string }[] = []
  for (const base of [dir, join(dir, 'done')]) {
    let entries
    try {
      entries = await readdir(base, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'done') continue
      const path = join(base, e.name, 'story.md')
      try {
        await stat(path)
        out.push({ folder: e.name, path })
      } catch {
        /* folder without a story.md — skip */
      }
    }
  }
  return out
}

function storyPath(root: string, itemId: string): string {
  return join(featuresDir(root), stripNs(itemId), 'story.md')
}

export const nativeAdapter: FrameworkAdapter = {
  name: NS,

  async detect(ctx: AdapterContext) {
    try {
      await stat(featuresDir(ctx.root))
      return true
    } catch {
      return false
    }
  },

  async listItems(ctx: AdapterContext) {
    const folders = await listStoryFolders(featuresDir(ctx.root))
    return Promise.all(folders.map(async (f) => toWorkItem(f.folder, await readFile(f.path, 'utf8'), f.path)))
  },

  async getBody(ctx: AdapterContext, itemId: string) {
    const text = await readFile(storyPath(ctx.root, itemId), 'utf8')
    return splitFrontmatter(text).body.trim()
  },

  async setStatus(ctx: AdapterContext, itemId: string, status: string) {
    const path = storyPath(ctx.root, itemId)
    const text = await readFile(path, 'utf8')
    const { fm, body } = splitFrontmatter(text)
    fm.status = status
    fm.modified = new Date().toISOString()
    await writeFile(path, `---\n${stringify(fm)}---\n${body}`, 'utf8')
  }
}
