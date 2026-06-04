import * as vscode from 'vscode'
import * as path from 'path'
import { t } from './l10n'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import type { Feature, FeatureStatus, Priority, FilenamePattern } from '../shared/types'
import { getTitleFromContent, generateFeatureFilename } from '../shared/types'
import { parseFeatureFile, serializeFeature } from '../shared/featureFrontmatter'
import { featureMatchesEpicLane } from '../shared/epicLane'
import {
  ensureStatusSubfolders,
  moveFeatureFile,
  getStatusFromPath,
  getFeatureFilePath,
  fileExists,
  type FsAdapter
} from './featureFileUtils'

export interface CreateFeatureData {
  status: FeatureStatus
  priority: Priority
  content: string
  assignee: string | null
  epic: string | null
  dueDate: string | null
  labels: string[]
}

export class FeatureRepository implements vscode.Disposable {
  private _features: Feature[] = []
  private _emitter = new vscode.EventEmitter<readonly Feature[]>()
  private _fileWatcher?: vscode.FileSystemWatcher
  private _watcherDisposables: vscode.Disposable[] = []
  private _currentWatcherDir: string | null = null
  private _migrating = false
  private _debounceTimer?: ReturnType<typeof setTimeout>
  private _lastWrittenContents = new Map<string, string>()
  private _rootOverride: string | null = null
  private _loadVersion = 0

  readonly onDidChange: vscode.Event<readonly Feature[]> = this._emitter.event

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _fs: FsAdapter = vscode.workspace.fs as unknown as FsAdapter
  ) {}

  get features(): readonly Feature[] {
    return this._features
  }

  getEffectiveRoot(): string | null {
    return this._rootOverride ?? (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null)
  }

  getFeaturesDir(): string | null {
    const root = this.getEffectiveRoot()
    if (!root) return null
    const config = vscode.workspace.getConfiguration('kanban-markdown')
    const dir = config.get<string>('featuresDirectory') || '.kanban/features'
    return path.join(root, dir)
  }

  async setRoot(newRoot: string | null): Promise<void> {
    this._rootOverride = newRoot
    if (this._fileWatcher) {
      this._fileWatcher.dispose()
      this._fileWatcher = undefined
    }
    this._currentWatcherDir = null // force _setupWatcher to re-run even if dir unchanged
    await this.load()
  }

  /** @internal — test only, bypasses async load */
  setRootSync(newRoot: string | null): void {
    this._rootOverride = newRoot
  }

  async load(): Promise<void> {
    const myVersion = ++this._loadVersion
    const featuresDir = this.getFeaturesDir()

    // Re-create watcher only when the directory changes
    if (featuresDir !== this._currentWatcherDir) {
      this._setupWatcher(featuresDir)
      this._currentWatcherDir = featuresDir
    }

    if (!featuresDir) {
      if (myVersion === this._loadVersion) {
        this._features = []
        this._emitter.fire(this._features)
      }
      return
    }

    try {
      await this._fs.createDirectory(vscode.Uri.file(featuresDir))
      await ensureStatusSubfolders(featuresDir, this._fs)

      // Phase 1: Old-subfolder migration
      this._migrating = true
      try {
        const oldFolders = ['backlog', 'todo', 'in-progress', 'review']
        for (const folder of oldFolders) {
          const subdir = path.join(featuresDir, folder)
          try {
            const entries = await this._fs.readDirectory(vscode.Uri.file(subdir))
            for (const [name, type] of entries) {
              if (type !== 1 /* File */ || !name.endsWith('.md')) continue
              const filePath = path.join(subdir, name)
              try {
                const bytes = await this._fs.readFile(vscode.Uri.file(filePath))
                const raw = new TextDecoder().decode(bytes)
                const feature = parseFeatureFile(raw, filePath)
                const status = feature?.status || 'backlog'
                await moveFeatureFile(filePath, featuresDir, status, this._fs)
              } catch { /* skip */ }
            }
          } catch { /* subfolder doesn't exist */ }
        }

        // Remove empty old status folders
        for (const folder of oldFolders) {
          const subdir = path.join(featuresDir, folder)
          try {
            const entries = await this._fs.readDirectory(vscode.Uri.file(subdir))
            if (entries.length === 0) await this._fs.delete(vscode.Uri.file(subdir))
          } catch { /* skip */ }
        }

        // Root files with status: done → move to done/
        const rootCheck = await this._fs.readDirectory(vscode.Uri.file(featuresDir))
        for (const [name, type] of rootCheck) {
          if (type !== 1 /* File */ || !name.endsWith('.md')) continue
          const filePath = path.join(featuresDir, name)
          try {
            const bytes = await this._fs.readFile(vscode.Uri.file(filePath))
            const raw = new TextDecoder().decode(bytes)
            const feature = parseFeatureFile(raw, filePath)
            if (feature?.status === 'done') await moveFeatureFile(filePath, featuresDir, 'done', this._fs)
          } catch { /* skip */ }
        }
      } finally {
        this._migrating = false
      }

      // Phase 2: Load root + done/
      const features: Feature[] = []
      const rootEntries = await this._fs.readDirectory(vscode.Uri.file(featuresDir))
      for (const [file, fileType] of rootEntries) {
        if (fileType !== 1 /* File */ || !file.endsWith('.md')) continue
        const filePath = path.join(featuresDir, file)
        const bytes = await this._fs.readFile(vscode.Uri.file(filePath))
        const raw = new TextDecoder().decode(bytes)
        const feature = parseFeatureFile(raw, filePath)
        if (feature) features.push(feature)
      }

      const doneDir = path.join(featuresDir, 'done')
      try {
        const doneEntries = await this._fs.readDirectory(vscode.Uri.file(doneDir))
        for (const [file, fileType] of doneEntries) {
          if (fileType !== 1 /* File */ || !file.endsWith('.md')) continue
          const filePath = path.join(doneDir, file)
          const bytes = await this._fs.readFile(vscode.Uri.file(filePath))
          const raw = new TextDecoder().decode(bytes)
          const feature = parseFeatureFile(raw, filePath)
          if (feature) features.push(feature)
        }
      } catch { /* done/ may not exist yet */ }

      // Phase 3: Reconcile done ↔ non-done mismatches
      this._migrating = true
      try {
        for (const feature of features) {
          const pathStatus = getStatusFromPath(feature.filePath, featuresDir)
          const inDone = pathStatus === 'done'
          const isDone = feature.status === 'done'
          if (isDone && !inDone) {
            try {
              feature.filePath = await moveFeatureFile(feature.filePath, featuresDir, 'done', this._fs)
            } catch { /* retry on next load */ }
          } else if (!isDone && inDone) {
            try {
              feature.filePath = await moveFeatureFile(feature.filePath, featuresDir, feature.status, this._fs)
            } catch { /* retry on next load */ }
          }
        }
      } finally {
        this._migrating = false
      }

      // Legacy integer order migration
      if (features.some(f => /^\d+$/.test(f.order))) {
        this._migrating = true
        try {
          const byStatus = new Map<string, Feature[]>()
          for (const f of features) {
            const list = byStatus.get(f.status) ?? []
            list.push(f)
            byStatus.set(f.status, list)
          }
          for (const col of byStatus.values()) {
            col.sort((a, b) => parseInt(a.order) - parseInt(b.order))
            const keys = generateNKeysBetween(null, null, col.length)
            for (let i = 0; i < col.length; i++) {
              col[i].order = keys[i]
              const content = serializeFeature(col[i])
              await this._fs.writeFile(vscode.Uri.file(col[i].filePath), new TextEncoder().encode(content))
            }
          }
        } finally {
          this._migrating = false
        }
      }

      if (myVersion === this._loadVersion) {
        this._features = features.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
      }
    } catch (err) {
      if (myVersion === this._loadVersion) {
        vscode.window.showErrorMessage(t('panel.loadFailed', { error: String(err) }))
        this._features = []
      }
    }

    if (myVersion === this._loadVersion) {
      this._emitter.fire(this._features)
    }
  }

  private _setupWatcher(featuresDir: string | null): void {
    if (this._fileWatcher) {
      this._fileWatcher.dispose()
      this._fileWatcher = undefined
    }
    this._watcherDisposables.forEach(d => d.dispose())
    this._watcherDisposables = []
    if (!featuresDir) return

    const pattern = new vscode.RelativePattern(featuresDir, '**/*.md')
    this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern)

    const handle = (uri: vscode.Uri) => this._handleFileChange(uri)
    this._watcherDisposables.push(this._fileWatcher.onDidChange(handle))
    this._watcherDisposables.push(this._fileWatcher.onDidCreate(handle))
    this._watcherDisposables.push(this._fileWatcher.onDidDelete(handle))
  }

  private _handleFileChange(uri: vscode.Uri): void {
    if (this._migrating) return
    if (this._debounceTimer) clearTimeout(this._debounceTimer)
    this._debounceTimer = setTimeout(async () => {
      const filePath = uri.fsPath
      const lastWritten = this._lastWrittenContents.get(filePath)
      if (lastWritten !== undefined) {
        try {
          const bytes = await this._fs.readFile(uri)
          const diskContent = new TextDecoder().decode(bytes)
          if (diskContent === lastWritten) {
            this._lastWrittenContents.delete(filePath)
            return // echo — suppress reload
          }
        } catch { /* file deleted — fall through to reload */ }
        this._lastWrittenContents.delete(filePath)
      }
      await this.load()
    }, 100)
  }

  async createFeature(data: CreateFeatureData): Promise<Feature> {
    const featuresDir = this.getFeaturesDir()
    if (!featuresDir) throw new Error('No workspace open')

    await this._fs.createDirectory(vscode.Uri.file(featuresDir))
    await ensureStatusSubfolders(featuresDir, this._fs)

    const title = getTitleFromContent(data.content)
    const config = vscode.workspace.getConfiguration('kanban-markdown')
    const pattern = config.get<FilenamePattern>('filenamePattern', 'name-date')
    const now = new Date().toISOString()
    const addToTop = config.get<boolean>('addNewCardsToTop', false)

    const inStatus = this._features
      .filter(f => f.status === data.status)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    const newOrder = addToTop
      ? generateKeyBetween(null, inStatus[0]?.order ?? null)
      : generateKeyBetween(inStatus[inStatus.length - 1]?.order ?? null, null)

    const filename = generateFeatureFilename(title, pattern)
    let filePath = getFeatureFilePath(featuresDir, data.status, filename)
    let uniqueName = filename
    let counter = 1
    while (await fileExists(filePath, this._fs)) {
      uniqueName = `${filename}-${counter++}`
      filePath = getFeatureFilePath(featuresDir, data.status, uniqueName)
    }

    const feature: Feature = {
      id: uniqueName,
      status: data.status,
      priority: data.priority,
      assignee: data.assignee,
      epic: data.epic ? data.epic.trim() || null : null,
      dueDate: data.dueDate,
      created: now,
      modified: now,
      completedAt: data.status === 'done' ? now : null,
      labels: data.labels,
      order: newOrder,
      workspace: null,
      content: data.content,
      filePath
    }

    const serialized = serializeFeature(feature)
    this._lastWrittenContents.set(filePath, serialized)
    await this._fs.createDirectory(vscode.Uri.file(path.dirname(filePath)))
    try {
      await this._fs.writeFile(vscode.Uri.file(filePath), new TextEncoder().encode(serialized))
    } catch (err) {
      console.error('[kanban-markdown] writeFile failed:', err)
      vscode.window.showErrorMessage(t('panel.createFailed', { error: String(err) }))
      throw err
    }

    this._features.push(feature)
    this._features.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    this._emitter.fire(this._features)
    return feature
  }

  async updateFeature(featureId: string, updates: Partial<Feature>): Promise<void> {
    const feature = this._features.find(f => f.id === featureId)
    if (!feature) return

    const featuresDir = this.getFeaturesDir()
    if (!featuresDir) return

    const oldStatus = feature.status
    Object.assign(feature, updates)
    feature.modified = new Date().toISOString()
    if (updates.status !== undefined && oldStatus !== feature.status) {
      feature.completedAt = feature.status === 'done' ? feature.modified : null
    }

    const crossingDoneUpdate = oldStatus !== feature.status && (oldStatus === 'done' || feature.status === 'done')
    if (crossingDoneUpdate) this._migrating = true
    try {
      const serialized = serializeFeature(feature)
      this._lastWrittenContents.set(feature.filePath, serialized)
      try {
        await this._fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(serialized))
      } catch (err) {
        console.error('[kanban-markdown] writeFile failed:', err)
        vscode.window.showErrorMessage(t('panel.saveFailed', { error: String(err) }))
        await this.load()
        return
      }

      if (crossingDoneUpdate) {
        try {
          feature.filePath = await moveFeatureFile(feature.filePath, featuresDir, feature.status, this._fs)
        } catch { /* reconcile on next load */ }
      }
    } finally {
      if (crossingDoneUpdate) this._migrating = false
    }

    this._emitter.fire(this._features)
  }

  async moveFeature(featureId: string, newStatus: string, newOrder: number): Promise<void> {
    const feature = this._features.find(f => f.id === featureId)
    if (!feature) return

    const featuresDir = this.getFeaturesDir()
    if (!featuresDir) return

    const oldStatus = feature.status
    feature.status = newStatus as FeatureStatus
    feature.modified = new Date().toISOString()
    if (oldStatus !== newStatus) {
      feature.completedAt = newStatus === 'done' ? feature.modified : null
    }

    const targetCol = this._features
      .filter(f => f.status === newStatus && f.id !== featureId)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    const clamped = Math.max(0, Math.min(newOrder, targetCol.length))
    feature.order = generateKeyBetween(
      clamped > 0 ? targetCol[clamped - 1].order : null,
      clamped < targetCol.length ? targetCol[clamped].order : null
    )

    const crossingDone = oldStatus !== newStatus && (oldStatus === 'done' || newStatus === 'done')
    if (crossingDone) this._migrating = true
    try {
      const serialized = serializeFeature(feature)
      this._lastWrittenContents.set(feature.filePath, serialized)
      try {
        await this._fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(serialized))
      } catch (err) {
        console.error('[kanban-markdown] writeFile failed:', err)
        vscode.window.showErrorMessage(t('panel.moveFailed', { error: String(err) }))
        await this.load()
        return
      }

      if (crossingDone) {
        try {
          feature.filePath = await moveFeatureFile(feature.filePath, featuresDir, newStatus, this._fs)
        } catch { /* reconcile on next load */ }
      }
    } finally {
      if (crossingDone) this._migrating = false
    }

    this._emitter.fire(this._features)
  }

  async deleteFeature(featureId: string): Promise<void> {
    const feature = this._features.find(f => f.id === featureId)
    if (!feature) return
    this._lastWrittenContents.delete(feature.filePath)
    await this._fs.delete(vscode.Uri.file(feature.filePath))
    this._features = this._features.filter(f => f.id !== featureId)
    this._emitter.fire(this._features)
  }

  async moveAllFeatures(
    sourceColumnId: string,
    targetColumnId: string,
    epicLane?: string | null
  ): Promise<void> {
    const featuresDir = this.getFeaturesDir()
    if (!featuresDir) return

    const source = this._features
      .filter(f => f.status === sourceColumnId && featureMatchesEpicLane(f, epicLane))
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    if (source.length === 0) return

    const targetTail = this._features
      .filter(f => f.status === targetColumnId)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))

    const lastOrder = targetTail[targetTail.length - 1]?.order ?? null
    const keys = generateNKeysBetween(lastOrder, null, source.length)

    const crossingDone = sourceColumnId === 'done' || targetColumnId === 'done'
    this._migrating = crossingDone
    let failedCount = 0
    try {
      for (let i = 0; i < source.length; i++) {
        const f = source[i]
        f.status = targetColumnId as FeatureStatus
        f.modified = new Date().toISOString()
        f.completedAt = targetColumnId === 'done' ? f.modified : null
        f.order = keys[i]

        const serialized = serializeFeature(f)
        this._lastWrittenContents.set(f.filePath, serialized)
        try {
          await this._fs.writeFile(vscode.Uri.file(f.filePath), new TextEncoder().encode(serialized))
        } catch (err) {
          console.error('[kanban-markdown] writeFile failed for', f.id, err)
          failedCount++
          continue
        }

        if (crossingDone) {
          try {
            f.filePath = await moveFeatureFile(f.filePath, featuresDir, targetColumnId, this._fs)
          } catch { /* reconcile on next load */ }
        }
      }
    } finally {
      this._migrating = false
    }

    if (failedCount > 0) {
      const msg = failedCount === 1
        ? t('panel.moveAllFailedOne')
        : t('panel.moveAllFailedOther', { count: failedCount })
      vscode.window.showWarningMessage(msg)
      await this.load()
      return
    }

    this._emitter.fire(this._features)
  }

  async archiveFeatures(sourceColumnId: string): Promise<{ failedCount: number }> {
    const featuresDir = this.getFeaturesDir()
    if (!featuresDir) return { failedCount: 0 }

    const source = this._features.filter(f => f.status === sourceColumnId)
    if (source.length === 0) return { failedCount: 0 }

    const archivedDir = path.join(featuresDir, 'archived')
    await this._fs.createDirectory(vscode.Uri.file(archivedDir))

    this._migrating = true
    const archivedIds = new Set<string>()
    let failedCount = 0

    try {
      for (const feature of source) {
        const filename = path.basename(feature.filePath)
        const ext = path.extname(filename)
        const base = path.basename(filename, ext)
        let targetPath = path.join(archivedDir, filename)
        let counter = 1
        while (await fileExists(targetPath, this._fs)) {
          targetPath = path.join(archivedDir, `${base}-${counter++}${ext}`)
        }
        try {
          this._lastWrittenContents.delete(feature.filePath)
          await this._fs.rename(vscode.Uri.file(feature.filePath), vscode.Uri.file(targetPath))
          archivedIds.add(feature.id)
        } catch {
          failedCount++
        }
      }
      this._features = this._features.filter(f => !archivedIds.has(f.id))
    } finally {
      this._migrating = false
    }

    this._emitter.fire(this._features)
    return { failedCount }
  }

  async renameLabel(oldName: string, newName: string): Promise<number> {
    const trimOld = oldName.trim()
    const trimNew = newName.trim()
    if (!trimOld || !trimNew || trimOld === trimNew) return 0

    let count = 0
    let failedCount = 0
    for (const feature of this._features) {
      const idx = feature.labels.indexOf(trimOld)
      if (idx === -1) continue
      if (feature.labels.includes(trimNew)) {
        feature.labels.splice(idx, 1)
      } else {
        feature.labels[idx] = trimNew
      }
      feature.modified = new Date().toISOString()
      const serialized = serializeFeature(feature)
      this._lastWrittenContents.set(feature.filePath, serialized)
      try {
        await this._fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(serialized))
        count++
      } catch (err) {
        console.error('[kanban-markdown] writeFile failed for', feature.id, err)
        failedCount++
      }
    }

    if (failedCount > 0) {
      const msg = failedCount === 1
        ? t('panel.renameLabelFailedOne')
        : t('panel.renameLabelFailedOther', { count: failedCount })
      vscode.window.showWarningMessage(msg)
      await this.load()
    } else if (count > 0) {
      this._emitter.fire(this._features)
    }
    return count
  }

  async deleteLabel(labelName: string): Promise<void> {
    const trimmed = labelName.trim()
    if (!trimmed) return

    let changed = false
    let failedCount = 0
    for (const feature of this._features) {
      const idx = feature.labels.indexOf(trimmed)
      if (idx === -1) continue
      feature.labels.splice(idx, 1)
      feature.modified = new Date().toISOString()
      const serialized = serializeFeature(feature)
      this._lastWrittenContents.set(feature.filePath, serialized)
      try {
        await this._fs.writeFile(vscode.Uri.file(feature.filePath), new TextEncoder().encode(serialized))
        changed = true
      } catch (err) {
        console.error('[kanban-markdown] writeFile failed for', feature.id, err)
        failedCount++
      }
    }

    if (failedCount > 0) {
      const msg = failedCount === 1
        ? t('panel.deleteLabelFailedOne')
        : t('panel.deleteLabelFailedOther', { count: failedCount })
      vscode.window.showWarningMessage(msg)
      await this.load()
    } else if (changed) {
      this._emitter.fire(this._features)
    }
  }

  async migrateFilenames(pattern: FilenamePattern): Promise<{ renamed: number; skipped: number }> {
    const featuresDir = this.getFeaturesDir()
    if (!featuresDir) return { renamed: 0, skipped: 0 }

    let renamed = 0
    let skipped = 0

    this._migrating = true
    try {
      for (const feature of this._features) {
        const title = getTitleFromContent(feature.content)
        const createdDate = new Date(feature.created)
        const newFilename = generateFeatureFilename(title, pattern, createdDate)
        if (newFilename === feature.id) continue

        const newFilePath = getFeatureFilePath(featuresDir, feature.status, newFilename)
        if (await fileExists(newFilePath, this._fs)) { skipped++; continue }

        const oldPath = feature.filePath
        feature.id = newFilename
        feature.filePath = newFilePath

        const serialized = serializeFeature(feature)
        await this._fs.createDirectory(vscode.Uri.file(path.dirname(newFilePath)))
        await this._fs.writeFile(vscode.Uri.file(newFilePath), new TextEncoder().encode(serialized))
        await this._fs.delete(vscode.Uri.file(oldPath))
        renamed++
      }
    } finally {
      this._migrating = false
    }

    await this.load() // reloads and fires onDidChange
    return { renamed, skipped }
  }

  dispose(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer)
    this._watcherDisposables.forEach(d => d.dispose())
    if (this._fileWatcher) this._fileWatcher.dispose()
    this._emitter.dispose()
  }
}
