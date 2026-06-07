import { readdir, readFile, writeFile, stat, mkdir, rm } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { stringify } from 'yaml'
import type { WorkItem, NormStatus, Priority, WorkItemType } from '../contract'
import type { FrameworkAdapter, AdapterContext, CreateItemInput, ItemPatch } from './types'
import { splitFrontmatter, titleFromBody, acceptanceCriteria } from './markdown'

const NS = 'native'
const id = (folder: string) => `${NS}:${folder}`
const stripNs = (x: string) => (x.startsWith(`${NS}:`) ? x.slice(NS.length + 1) : x)

const kanbanDir   = (root: string) => join(root, '.kanban')
const featuresDir = (root: string) => join(kanbanDir(root), 'features')
const WALK_IGNORE = new Set(['node_modules', '.git'])

function toWorkItem(rawId: string, text: string, path: string): WorkItem {
  const { fm, body } = splitFrontmatter(text)
  const deps = Array.isArray(fm.dependsOn) ? (fm.dependsOn as unknown[]).map(String) : []
  return {
    id: id(rawId),
    source: { framework: NS, path },
    type: (fm.type as WorkItemType) ?? 'story',
    title: titleFromBody(body, rawId),
    status: (fm.status as NormStatus) ?? 'backlog',
    priority: (fm.priority as Priority) ?? null,
    parent: fm.epic ? id(String(fm.epic)) : null,
    children: [],
    dependsOn: deps.map((d) => id(stripNs(d))),
    labels: Array.isArray(fm.labels) ? (fm.labels as unknown[]).map(String) : [],
    estimate: typeof fm.estimate === 'string' ? fm.estimate : null,
    acceptanceCriteria: acceptanceCriteria(body),
    bodyRef: `${id(rawId)}#body`,
    order:       typeof fm.order       === 'string' ? fm.order       : null,
    assignee:    typeof fm.assignee    === 'string' ? fm.assignee    : null,
    dueDate:     typeof fm.dueDate     === 'string' ? fm.dueDate     : null,
    created:     typeof fm.created     === 'string' ? fm.created     : null,
    modified:    typeof fm.modified    === 'string' ? fm.modified    : null,
    completedAt: typeof fm.completedAt === 'string' ? fm.completedAt : null,
  }
}

async function walkMdFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(d: string) {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch { return }
    for (const e of entries) {
      if (WALK_IGNORE.has(e.name)) continue
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile() && e.name.endsWith('.md')) out.push(p)
    }
  }
  await walk(dir)
  return out
}

async function listFolderFormatItems(root: string): Promise<WorkItem[]> {
  const folders = await listStoryFolders(featuresDir(root))
  return Promise.all(
    folders.map(async (f) => toWorkItem(f.folder, await readFile(f.path, 'utf8'), f.path))
  )
}

async function listRecursiveExtras(root: string, exclude: Set<string>): Promise<WorkItem[]> {
  const base = kanbanDir(root)
  const files = await walkMdFiles(base)
  const items: WorkItem[] = []
  for (const path of files) {
    if (exclude.has(path)) continue
    const text = await readFile(path, 'utf8')
    const { fm } = splitFrontmatter(text)
    if (typeof fm.status !== 'string') continue
    const rel = relative(base, path).split(sep).join('/').replace(/\.md$/, '')
    const rawId = typeof fm.id === 'string' && fm.id.length > 0 ? fm.id : rel
    items.push(toWorkItem(rawId, text, path))
  }
  return items
}

async function listAllItems(root: string): Promise<WorkItem[]> {
  const folderItems = await listFolderFormatItems(root)
  const folderPaths = new Set(folderItems.map((i) => i.source.path))
  const extras = await listRecursiveExtras(root, folderPaths)
  return [...folderItems, ...extras]
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
      if (!(await stat(kanbanDir(ctx.root))).isDirectory()) return false
    } catch { return false }
    try {
      if ((await stat(featuresDir(ctx.root))).isDirectory()) return true
    } catch { /* no features/ dir — fall through */ }
    for (const path of await walkMdFiles(kanbanDir(ctx.root))) {
      const { fm } = splitFrontmatter(await readFile(path, 'utf8'))
      if (typeof fm.status === 'string') return true
    }
    return false
  },

  async listItems(ctx: AdapterContext) {
    return listAllItems(ctx.root)
  },

  async getBody(ctx: AdapterContext, itemId: string) {
    try {
      const { path } = await resolveStoryPath(ctx.root, stripNs(itemId))
      return splitFrontmatter(await readFile(path, 'utf8')).body.trim()
    } catch (e) {
      const extras = await listRecursiveExtras(ctx.root, new Set())
      const item = extras.find((i) => i.id === itemId)
      if (!item) throw e
      return splitFrontmatter(await readFile(item.source.path, 'utf8')).body.trim()
    }
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
    const status = input.status ?? 'backlog'
    const fm: Record<string, unknown> = {
      id: folderId,
      type: input.type,
      status,
      priority: input.priority ?? null,
      epic: input.parent ? stripNs(input.parent) : null,
      order: input.order ?? null,
      assignee: input.assignee ?? null,
      dueDate: input.dueDate ?? null,
      dependsOn: (input.dependsOn ?? []).map((d) => stripNs(d)),
      labels: input.labels ?? [],
      estimate: input.estimate ?? null,
      sessions: [],
      created: now,
      modified: now,
      completedAt: status === 'done' ? now : null,
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

    const prevStatus = fm.status
    if (patch.status   !== undefined) fm.status   = patch.status
    if (patch.priority !== undefined) fm.priority = patch.priority
    if (patch.parent   !== undefined) fm.epic     = patch.parent ? stripNs(patch.parent) : null
    if (patch.dependsOn !== undefined) fm.dependsOn = patch.dependsOn.map((d) => stripNs(d))
    if (patch.labels   !== undefined) fm.labels   = patch.labels
    if (patch.estimate !== undefined) fm.estimate = patch.estimate
    if (patch.order    !== undefined) fm.order    = patch.order
    if (patch.assignee !== undefined) fm.assignee = patch.assignee
    if (patch.dueDate  !== undefined) fm.dueDate  = patch.dueDate
    if (patch.title    !== undefined) body = applyTitleToBody(body, patch.title)
    if (patch.acceptanceCriteria !== undefined) body = replaceAcSection(body, patch.acceptanceCriteria)

    const now = new Date().toISOString()
    fm.modified = now
    if (patch.status === 'done' && prevStatus !== 'done') fm.completedAt = now
    if (patch.status !== undefined && patch.status !== 'done') fm.completedAt = null

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
