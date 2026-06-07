import * as vscode from 'vscode'
import * as path from 'path'
import {
  listWorkItems,
  getItemBody,
  setBoardRoot,
  createItem,
  updateItem,
  setBody,
  deleteItem,
  type WorkItem,
} from '@kanban/backlog-mcp'
import type { Feature, FeatureStatus, FilenamePattern, Priority, SchemaType } from '../shared/types'
import { getTitleFromContent } from '../shared/types'
import type { CreateFeatureData, IFeatureRepository } from './FeatureRepository'

const COLUMN_STATUS = new Set<FeatureStatus>(['backlog', 'todo', 'in-progress', 'review', 'done'])

function toFeatureStatus(status: string): FeatureStatus {
  if (COLUMN_STATUS.has(status as FeatureStatus)) return status as FeatureStatus
  if (status === 'blocked') return 'todo'
  if (status === 'cancelled') return 'done'
  return 'backlog'
}

function toFeature(wi: WorkItem): Feature {
  const now = new Date().toISOString()
  return {
    id: wi.id,
    status: toFeatureStatus(wi.status),
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

export class McpFeatureRepository implements IFeatureRepository {
  private _features: Feature[] = []
  private readonly _emitter = new vscode.EventEmitter<readonly Feature[]>()
  private _watcher: vscode.FileSystemWatcher | undefined
  private _root: string | null
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined

  readonly onDidChange = this._emitter.event
  readonly schema: SchemaType = 'feature'

  constructor(root: string | null) {
    this._root = root
    if (root) {
      setBoardRoot(root)
      this._installWatcher(root)
    }
  }

  get features(): readonly Feature[] { return this._features }

  getEffectiveRoot(): string | null { return this._root }

  getFeaturesDir(): string | null {
    return this._root ? path.join(this._root, '.kanban', 'features') : null
  }

  async setRoot(newRoot: string | null): Promise<void> {
    this._root = newRoot
    this._disposeWatcher()
    if (newRoot) {
      setBoardRoot(newRoot)
      this._installWatcher(newRoot)
    }
    await this.load()
  }

  setRootSync(newRoot: string | null): void {
    this._root = newRoot
    this._disposeWatcher()
    if (newRoot) {
      setBoardRoot(newRoot)
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
    const items = await listWorkItems()
    this._features = items.map(toFeature)
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
  async moveAllFeatures(_src: string, _tgt: string, _epicLane?: string | null): Promise<void> {
    throw new Error('not implemented')
  }
  async archiveFeatures(_sourceColumnId: string): Promise<{ failedCount: number }> {
    throw new Error('not implemented')
  }
  async renameLabel(_oldName: string, _newName: string): Promise<number> {
    throw new Error('not implemented')
  }
  async deleteLabel(_labelName: string): Promise<void> {
    throw new Error('not implemented')
  }
  async migrateFilenames(_pattern: FilenamePattern): Promise<{ renamed: number; skipped: number }> {
    return { renamed: 0, skipped: 0 }
  }

  dispose(): void {
    this._disposeWatcher()
    this._emitter.dispose()
  }

  private _installWatcher(root: string): void {
    const pattern = new vscode.RelativePattern(root, '.kanban/features/**/story.md')
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
