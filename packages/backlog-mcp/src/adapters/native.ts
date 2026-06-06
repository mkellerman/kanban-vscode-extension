import { readdir, readFile, writeFile, stat, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { stringify } from 'yaml'
import type { WorkItem, NormStatus, Priority, WorkItemType } from '../contract'
import type { FrameworkAdapter, AdapterContext, CreateItemInput, ItemPatch } from './types'
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
    type: (fm.type as WorkItemType) ?? 'story',
    title: titleFromBody(body, folder),
    status: (fm.status as NormStatus) ?? 'backlog',
    priority: (fm.priority as Priority) ?? null,
    parent: fm.epic ? id(String(fm.epic)) : null,
    children: [],
    dependsOn: deps.map((d) => id(stripNs(d))),
    labels: Array.isArray(fm.labels) ? (fm.labels as unknown[]).map(String) : [],
    estimate: typeof fm.estimate === 'string' ? fm.estimate : null,
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

async function resolveStoryPath(
  root: string,
  folderId: string
): Promise<{ path: string; folderPath: string; inDone: boolean }> {
  const base = featuresDir(root)
  const activeFolderPath = join(base, folderId)
  const doneFolderPath = join(base, 'done', folderId)
  const activePath = join(activeFolderPath, 'story.md')
  const donePath = join(doneFolderPath, 'story.md')
  try {
    await stat(activePath)
    return { path: activePath, folderPath: activeFolderPath, inDone: false }
  } catch {}
  try {
    await stat(donePath)
    return { path: donePath, folderPath: doneFolderPath, inDone: true }
  } catch {}
  throw new Error(`story not found: ${folderId}`)
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

async function generateFolderId(root: string, title: string): Promise<string> {
  const date = new Date().toISOString().slice(0, 10)
  const base = `${slugify(title)}-${date}`
  const dir = featuresDir(root)
  let candidate = base
  let i = 2
  for (;;) {
    try {
      await stat(join(dir, candidate))
      candidate = `${base}-${i++}`
    } catch {
      return candidate
    }
  }
}

function buildBody(input: { title: string; body?: string; acceptanceCriteria?: string[] }): string {
  if (input.body !== undefined) return input.body
  let result = `# ${input.title}\n`
  if (input.acceptanceCriteria?.length) {
    result += `\n## Acceptance criteria\n${input.acceptanceCriteria.map((ac) => `- [ ] ${ac}`).join('\n')}\n`
  }
  return result
}

function applyTitleToBody(body: string, title: string): string {
  if (/^#\s+.+$/m.test(body)) return body.replace(/^#\s+.+$/m, `# ${title}`)
  return `# ${title}\n${body}`
}

function replaceAcSection(body: string, acs: string[]): string {
  const newSection =
    `## Acceptance criteria\n${acs.map((ac) => `- [ ] ${ac}`).join('\n')}\n`
  const parts = body.split(/^(?=## )/m)
  const idx = parts.findIndex((p) => /^## acceptance criteria\b/i.test(p))
  if (idx !== -1) {
    parts[idx] = newSection
    return parts.join('')
  }
  return body.trimEnd() + '\n\n' + newSection
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
    const { path } = await resolveStoryPath(ctx.root, stripNs(itemId))
    const text = await readFile(path, 'utf8')
    return splitFrontmatter(text).body.trim()
  },

  async setStatus(ctx: AdapterContext, itemId: string, status: string) {
    const { path } = await resolveStoryPath(ctx.root, stripNs(itemId))
    const text = await readFile(path, 'utf8')
    const { fm, body } = splitFrontmatter(text)
    fm.status = status
    fm.modified = new Date().toISOString()
    await writeFile(path, `---\n${stringify(fm)}---\n${body}`, 'utf8')
  },

  async createItem(ctx: AdapterContext, input: CreateItemInput): Promise<WorkItem> {
    const folderId = await generateFolderId(ctx.root, input.title)
    const folderPath = join(featuresDir(ctx.root), folderId)
    await mkdir(folderPath, { recursive: true })
    const now = new Date().toISOString()
    const fm: Record<string, unknown> = {
      id: folderId,
      type: input.type,
      status: input.status ?? 'backlog',
      priority: input.priority ?? null,
      epic: input.parent ? stripNs(input.parent) : null,
      order: null,
      dependsOn: (input.dependsOn ?? []).map((d) => stripNs(d)),
      labels: input.labels ?? [],
      estimate: input.estimate ?? null,
      sessions: [],
      created: now,
      modified: now,
    }
    const body = buildBody(input)
    const path = join(folderPath, 'story.md')
    await writeFile(path, `---\n${stringify(fm)}---\n${body}`, 'utf8')
    return toWorkItem(folderId, await readFile(path, 'utf8'), path)
  },

  async updateItem(ctx: AdapterContext, itemId: string, patch: ItemPatch): Promise<WorkItem> {
    const folderId = stripNs(itemId)
    const { path } = await resolveStoryPath(ctx.root, folderId)
    const text = await readFile(path, 'utf8')
    let { fm, body } = splitFrontmatter(text)

    if (patch.status !== undefined) fm.status = patch.status
    if (patch.priority !== undefined) fm.priority = patch.priority
    if (patch.parent !== undefined) fm.epic = patch.parent ? stripNs(patch.parent) : null
    if (patch.dependsOn !== undefined) fm.dependsOn = patch.dependsOn.map((d) => stripNs(d))
    if (patch.labels !== undefined) fm.labels = patch.labels
    if (patch.estimate !== undefined) fm.estimate = patch.estimate
    if (patch.title !== undefined) body = applyTitleToBody(body, patch.title)
    if (patch.acceptanceCriteria !== undefined) body = replaceAcSection(body, patch.acceptanceCriteria)
    fm.modified = new Date().toISOString()

    await writeFile(path, `---\n${stringify(fm)}---\n${body}`, 'utf8')
    return toWorkItem(folderId, await readFile(path, 'utf8'), path)
  },

  async setBody(ctx: AdapterContext, itemId: string, newBody: string): Promise<void> {
    const { path } = await resolveStoryPath(ctx.root, stripNs(itemId))
    const text = await readFile(path, 'utf8')
    const { fm } = splitFrontmatter(text)
    await writeFile(path, `---\n${stringify(fm)}---\n${newBody}`, 'utf8')
  },

  async deleteItem(ctx: AdapterContext, itemId: string): Promise<void> {
    const { folderPath } = await resolveStoryPath(ctx.root, stripNs(itemId))
    await rm(folderPath, { recursive: true })
  },
}
