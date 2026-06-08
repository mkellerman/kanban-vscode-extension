import * as vscode from 'vscode'
import * as path from 'path'
import {
  listWorkItems,
  getItemBody,
  setBoardRoot,
  setKanbanDir,
  createItem,
  updateItem,
  setBody,
  deleteItem,
  type WorkItem,
} from '@kanban/backlog-mcp'
import { featureMatchesEpicLane } from '../shared/epicLane'
import type { Feature, FeatureStatus, FilenamePattern, Priority, SchemaType } from '../shared/types'
import { getTitleFromContent } from '../shared/types'
import type { CreateFeatureData, IFeatureRepository } from './FeatureRepository'

const COLUMN_STATUS = new Set<FeatureStatus>(['backlog', 'todo', 'in-progress', 'review', 'done'])

/** Map a raw WorkItem status to a board column id, or `null` if it doesn't
 *  belong on the board (e.g. `draft`, `deferred`). `blocked`/`cancelled` are
 *  preserved as known aliases. */
function toFeatureStatus(status: string): FeatureStatus | null {
  if (COLUMN_STATUS.has(status as FeatureStatus)) return status as FeatureStatus
  if (status === 'blocked') return 'todo'
  if (status === 'cancelled') return 'done'
  return null
}

function toFeature(wi: WorkItem): Feature | null {
  const mapped = toFeatureStatus(wi.status)
  if (mapped === null) return null
  const now = new Date().toISOString()
  return {
    id: wi.id,
    status: mapped,
    priority: (wi.priority ?? 'medium') as Priority,
    assignee: wi.assignee ?? null,
    epic: wi.parent,
    dueDate: wi.dueDate ?? null,
    created: wi.created ?? now,
    modified: wi.modified ?? now,
    completedAt: wi.completedAt ?? null,
    labels: wi.labels,
    order: wi.order ?? 'a0',
    workspace: null,
    content: `# ${wi.title}\n`,
    filePath: wi.source.path,
    _extraFrontmatter: {
      source: wi.source.framework,
      dependsOn: wi.dependsOn.join(','),
    },
  }
}

const DEFAULT_KANBAN_DIR = '.kanban/features'

export class McpFeatureRepository implements IFeatureRepository {
  private _features: Feature[] = []
  private readonly _emitter = new vscode.EventEmitter<readonly Feature[]>()
  private _watcher: vscode.FileSystemWatcher | undefined
  private _root: string | null
  private _kanbanDir: string
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined

  readonly onDidChange = this._emitter.event
  readonly schema: SchemaType = 'feature'

  constructor(root: string | null, kanbanDir: string = DEFAULT_KANBAN_DIR) {
    this._root = root
    this._kanbanDir = kanbanDir || DEFAULT_KANBAN_DIR
    if (root) {
      setBoardRoot(root)
      setKanbanDir(this._kanbanDir)
      this._installWatcher(root)
    }
  }

  get features(): readonly Feature[] { return this._features }

  getEffectiveRoot(): string | null { return this._root }

  getFeaturesDir(): string | null {
    return this._root ? path.join(this._root, this._kanbanDir) : null
  }

  async setRoot(newRoot: string | null): Promise<void> {
    this._root = newRoot
    this._disposeWatcher()
    if (newRoot) {
      setBoardRoot(newRoot)
      setKanbanDir(this._kanbanDir)
      this._installWatcher(newRoot)
    }
    await this.load()
  }

  setRootSync(newRoot: string | null): void {
    this._root = newRoot
    this._disposeWatcher()
    if (newRoot) {
      setBoardRoot(newRoot)
      setKanbanDir(this._kanbanDir)
      this._installWatcher(newRoot)
    }
  }

  async load(): Promise<void> {
    if (!this._root) {
      this._features = []
      this._emitter.fire(this._features)
      return
    }
    setBoardRoot(this._root)
    setKanbanDir(this._kanbanDir)
    const items = await listWorkItems()
    const mapped: Feature[] = []
    let dropped = 0
    for (const wi of items) {
      const feat = toFeature(wi)
      if (feat) mapped.push(feat)
      else dropped++
    }
    if (dropped > 0) {
      console.warn(`[kanban-mcp] ${dropped} item(s) hidden: status not mapped to a board column`)
    }
    this._features = mapped
    this._emitter.fire(this._features)
  }

  async getBody(featureId: string): Promise<string> {
    return await getItemBody(featureId)
  }

  async createFeature(data: CreateFeatureData): Promise<Feature> {
    const title = getTitleFromContent(data.content)
    const wi = await createItem({
      type: 'story',
      title: title || 'Untitled',
      status: data.status,
      priority: data.priority,
      parent: data.epic,
      labels: data.labels,
      assignee: data.assignee,
      dueDate: data.dueDate,
      body: data.content,
    })
    await this.load()
    const feat = this._features.find(f => f.id === wi.id)
    if (!feat) throw new Error(`createFeature: lost track of created item ${wi.id}`)
    return feat
  }

  async updateFeature(featureId: string, updates: Partial<Feature>): Promise<void> {
    await updateItem(featureId, {
      status:   updates.status,
      priority: updates.priority,
      parent:   updates.epic,
      labels:   updates.labels,
      assignee: updates.assignee,
      dueDate:  updates.dueDate,
    })
    if (typeof updates.content === 'string') {
      await setBody(featureId, updates.content)
    }
    await this.load()
  }

  async moveFeature(featureId: string, newStatus: string, newOrder: number): Promise<void> {
    await updateItem(featureId, {
      status: newStatus as Feature['status'],
      order: String(newOrder),
    })
    await this.load()
  }

  async deleteFeature(featureId: string): Promise<void> {
    await deleteItem(featureId)
    await this.load()
  }
  async moveAllFeatures(
    sourceColumnId: string,
    targetColumnId: string,
    epicLane?: string | null,
  ): Promise<void> {
    const ids = this._features
      .filter(f => f.status === sourceColumnId)
      .filter(f => epicLane === undefined || featureMatchesEpicLane(f, epicLane))
      .map(f => f.id)
    for (const id of ids) {
      await updateItem(id, { status: targetColumnId as Feature['status'] })
    }
    await this.load()
  }

  async archiveFeatures(sourceColumnId: string): Promise<{ failedCount: number }> {
    const ids = this._features.filter(f => f.status === sourceColumnId).map(f => f.id)
    let failed = 0
    for (const id of ids) {
      try {
        await updateItem(id, { status: 'done' })
      } catch {
        failed++
      }
    }
    await this.load()
    return { failedCount: failed }
  }

  async renameLabel(oldName: string, newName: string): Promise<number> {
    let count = 0
    for (const f of this._features) {
      if (!f.labels.includes(oldName)) continue
      const next = f.labels.map(l => (l === oldName ? newName : l))
      await updateItem(f.id, { labels: next })
      count++
    }
    await this.load()
    return count
  }

  async deleteLabel(labelName: string): Promise<void> {
    for (const f of this._features) {
      if (!f.labels.includes(labelName)) continue
      await updateItem(f.id, { labels: f.labels.filter(l => l !== labelName) })
    }
    await this.load()
  }
  async migrateFilenames(_pattern: FilenamePattern): Promise<{ renamed: number; skipped: number }> {
    return { renamed: 0, skipped: 0 }
  }

  dispose(): void {
    this._disposeWatcher()
    this._emitter.dispose()
  }

  private _installWatcher(root: string): void {
    const pattern = new vscode.RelativePattern(root, `${this._kanbanDir}/**/*.md`)
    const watcher = vscode.workspace.createFileSystemWatcher(pattern)
    const trigger = () => this._scheduleReload()
    watcher.onDidCreate(trigger)
    watcher.onDidChange(trigger)
    watcher.onDidDelete(trigger)
    this._watcher = watcher
  }

  private _scheduleReload(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer)
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = undefined
      void this.load()
    }, 100)
  }

  private _disposeWatcher(): void {
    this._watcher?.dispose()
    this._watcher = undefined
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer)
      this._debounceTimer = undefined
    }
  }
}
