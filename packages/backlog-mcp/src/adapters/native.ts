import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { stringify } from 'yaml'
import type { WorkItem, NormStatus, Priority } from '../contract'
import type { FrameworkAdapter, AdapterContext } from './types'
import { splitFrontmatter, titleFromBody, acceptanceCriteria } from './markdown'

const NS = 'native'
const id = (folder: string) => `${NS}:${folder}`
const stripNs = (x: string) => (x.startsWith(`${NS}:`) ? x.slice(NS.length + 1) : x)

const featuresDir = (root: string) => join(root, '.kanban', 'features')

function toWorkItem(folder: string, text: string, path: string): WorkItem {
  const { fm, body } = splitFrontmatter(text)
  const deps = Array.isArray(fm.dependsOn) ? (fm.dependsOn as unknown[]).map(String) : []
  return {
    id: id(folder),
    source: { framework: NS, path },
    type: 'story',
    title: titleFromBody(body, folder),
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
