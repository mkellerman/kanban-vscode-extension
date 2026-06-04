import * as vscode from 'vscode'
import { FeatureRepository, type CreateFeatureData, type IFeatureRepository } from './FeatureRepository'
import type { Feature, FilenamePattern, GroomedDirectory, SchemaType } from '../shared/types'
import type { FsAdapter } from './featureFileUtils'

export class FeatureRepositoryManager implements IFeatureRepository {
  private readonly _repos: FeatureRepository[]
  private readonly _emitter = new vscode.EventEmitter<readonly Feature[]>()
  private readonly _disposables: vscode.Disposable[] = []

  readonly onDidChange: vscode.Event<readonly Feature[]> = this._emitter.event

  constructor(
    context: vscode.ExtensionContext,
    dirs: GroomedDirectory[],
    fs?: FsAdapter
  ) {
    this._repos = dirs.map(d =>
      new FeatureRepository(context, { relativeDir: d.path, schema: d.schema }, fs)
    )
    for (const repo of this._repos) {
      this._disposables.push(
        repo.onDidChange(() => this._emitter.fire(this.features))
      )
    }
  }

  get features(): readonly Feature[] {
    return this._repos.flatMap(r => [...r.features])
  }

  get schema(): SchemaType { return 'feature' }

  getFeaturesDir(): string | null {
    return this._primaryRepo()?.getFeaturesDir() ?? null
  }

  getEffectiveRoot(): string | null {
    return this._primaryRepo()?.getEffectiveRoot() ?? null
  }

  private _primaryRepo(): FeatureRepository | undefined {
    return this._repos.find(r => r.schema === 'feature')
  }

  private _ownerOf(featureId: string): FeatureRepository | undefined {
    return this._repos.find(r => r.features.some(f => f.id === featureId))
  }

  async setRoot(newRoot: string | null): Promise<void> {
    await Promise.all(this._repos.map(r => r.setRoot(newRoot)))
  }

  setRootSync(newRoot: string | null): void {
    this._repos.forEach(r => r.setRootSync(newRoot))
  }

  async load(): Promise<void> {
    await Promise.all(this._repos.map(r => r.load()))
  }

  async createFeature(data: CreateFeatureData): Promise<Feature> {
    const repo = this._primaryRepo()
    if (!repo) throw new Error('No feature-schema repository configured')
    return repo.createFeature(data)
  }

  async updateFeature(featureId: string, updates: Partial<Feature>): Promise<void> {
    const repo = this._ownerOf(featureId)
    if (!repo) { console.warn(`FeatureRepositoryManager: no repo owns feature '${featureId}'`); return }
    await repo.updateFeature(featureId, updates)
  }

  async moveFeature(featureId: string, newStatus: string, newOrder: number): Promise<void> {
    const repo = this._ownerOf(featureId)
    if (!repo) { console.warn(`FeatureRepositoryManager: no repo owns feature '${featureId}'`); return }
    await repo.moveFeature(featureId, newStatus, newOrder)
  }

  async deleteFeature(featureId: string): Promise<void> {
    const repo = this._ownerOf(featureId)
    if (!repo) { console.warn(`FeatureRepositoryManager: no repo owns feature '${featureId}'`); return }
    await repo.deleteFeature(featureId)
  }

  async moveAllFeatures(
    sourceColumnId: string,
    targetColumnId: string,
    epicLane?: string | null
  ): Promise<void> {
    await Promise.all(this._repos.map(r => r.moveAllFeatures(sourceColumnId, targetColumnId, epicLane)))
  }

  async archiveFeatures(sourceColumnId: string): Promise<{ failedCount: number }> {
    const results = await Promise.all(this._repos.map(r => r.archiveFeatures(sourceColumnId)))
    return { failedCount: results.reduce((sum, r) => sum + r.failedCount, 0) }
  }

  async renameLabel(oldName: string, newName: string): Promise<number> {
    const counts = await Promise.all(this._repos.map(r => r.renameLabel(oldName, newName)))
    return counts.reduce((a, b) => a + b, 0)
  }

  async deleteLabel(labelName: string): Promise<void> {
    await Promise.all(this._repos.map(r => r.deleteLabel(labelName)))
  }

  async migrateFilenames(pattern: FilenamePattern): Promise<{ renamed: number; skipped: number }> {
    const results = await Promise.all(this._repos.map(r => r.migrateFilenames(pattern)))
    return {
      renamed: results.reduce((s, r) => s + r.renamed, 0),
      skipped: results.reduce((s, r) => s + r.skipped, 0)
    }
  }

  dispose(): void {
    this._disposables.forEach(d => d.dispose())
    this._repos.forEach(r => r.dispose())
    this._emitter.dispose()
  }
}
