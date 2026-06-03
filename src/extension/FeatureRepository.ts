import * as vscode from 'vscode'
import * as path from 'path'
import { generateNKeysBetween } from 'fractional-indexing'
import type { Feature, FeatureStatus, Priority } from '../shared/types'
import { parseFeatureFile, serializeFeature } from '../shared/featureFrontmatter'
import {
  ensureStatusSubfolders,
  moveFeatureFile,
  getStatusFromPath,
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

  readonly onDidChange: vscode.Event<readonly Feature[]> = this._emitter.event

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _fs: FsAdapter = vscode.workspace.fs as unknown as FsAdapter
  ) {}

  get features(): readonly Feature[] {
    return this._features
  }

  getFeaturesDir(): string | null {
    const folders = vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) return null
    const config = vscode.workspace.getConfiguration('kanban-markdown')
    const dir = config.get<string>('featuresDirectory') || '.kanban/features'
    return path.join(folders[0].uri.fsPath, dir)
  }

  async load(): Promise<void> {
    const featuresDir = this.getFeaturesDir()

    // Re-create watcher only when the directory changes
    if (featuresDir !== this._currentWatcherDir) {
      this._setupWatcher(featuresDir)
      this._currentWatcherDir = featuresDir
    }

    if (!featuresDir) {
      this._features = []
      this._emitter.fire(this._features)
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

      this._features = features.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    } catch {
      this._features = []
    }

    this._emitter.fire(this._features)
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

  dispose(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer)
    this._watcherDisposables.forEach(d => d.dispose())
    if (this._fileWatcher) this._fileWatcher.dispose()
    this._emitter.dispose()
  }
}
