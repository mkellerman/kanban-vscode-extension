import * as vscode from 'vscode'
import * as crypto from 'crypto'
import * as path from 'path'
import { getTitleFromContent, generateFeatureFilename, DEFAULT_COLUMNS } from '../shared/types'
import type { Feature, FeatureStatus, Priority, KanbanColumn, FeatureFrontmatter, CardDisplaySettings, FilenamePattern, BoardViewMode } from '../shared/types'
import { serializeFeature } from '../shared/featureFrontmatter'
import { t, getBundle, getEffectiveLocale, reloadBundle, getAllDefaultColumnNames, getDefaultColumnNamesForLocale } from './l10n'
import type { FeatureRepository, CreateFeatureData } from './FeatureRepository'
import type { AgentLauncher } from './AgentLauncher'

export class KanbanPanel {
  public static readonly viewType = 'kanban-markdown.panel'
  public static currentPanel: KanbanPanel | undefined

  private readonly _panel: vscode.WebviewPanel
  private readonly _extensionUri: vscode.Uri
  private readonly _context: vscode.ExtensionContext
  private _repo: FeatureRepository
  private _launcher: AgentLauncher
  private _disposables: vscode.Disposable[] = []
  private _currentEditingFeatureId: string | null = null
  private _lastSentEditorContent: string = ''
  private _savingFeatureContent = false
  private _onDisposeCallbacks: (() => void)[] = []

  public static createOrShow(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    repo: FeatureRepository,
    launcher: AgentLauncher
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined

    // If we already have a panel, show it
    if (KanbanPanel.currentPanel) {
      KanbanPanel.currentPanel._panel.reveal(column)
      return
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      KanbanPanel.viewType,
      t('panel.title'),
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist'),
          vscode.Uri.joinPath(extensionUri, 'dist', 'webview')
        ]
      }
    )

    // Set the tab icon
    panel.iconPath = {
      light: vscode.Uri.joinPath(extensionUri, 'resources', 'kanban-light.svg'),
      dark: vscode.Uri.joinPath(extensionUri, 'resources', 'kanban-dark.svg')
    }

    KanbanPanel.currentPanel = new KanbanPanel(panel, extensionUri, context, repo, launcher)
  }

  public static revive(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    repo: FeatureRepository,
    launcher: AgentLauncher
  ) {
    KanbanPanel.currentPanel = new KanbanPanel(panel, extensionUri, context, repo, launcher)
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    repo: FeatureRepository,
    launcher: AgentLauncher
  ) {
    this._panel = panel
    this._extensionUri = extensionUri
    this._context = context
    this._repo = repo
    this._launcher = launcher

    // Ensure webview options are set (critical for deserialization after reload)
    this._panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'dist'),
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview')
      ]
    }

    // Set the webview's initial html content
    this._update()

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'ready':
            await this._repo.load()
            break
          case 'createFeature': {
            const created = await this._repo.createFeature(message.data as CreateFeatureData)
            const createConfig = vscode.workspace.getConfiguration('kanban-markdown')
            if (createConfig.get<boolean>('markdownEditorMode', false)) {
              this._openFeatureInNativeEditor(created.id)
            }
            break
          }
          case 'moveFeature':
            await this._repo.moveFeature(message.featureId, message.newStatus, message.newOrder)
            break
          case 'deleteFeature':
            await this._repo.deleteFeature(message.featureId)
            break
          case 'updateFeature':
            await this._repo.updateFeature(message.featureId, message.updates)
            break
          case 'openFeature': {
            const openConfig = vscode.workspace.getConfiguration('kanban-markdown')
            if (openConfig.get<boolean>('markdownEditorMode', false)) {
              this._openFeatureInNativeEditor(message.featureId)
            } else {
              await this._sendFeatureContent(message.featureId)
            }
            break
          }
          case 'saveFeatureContent':
            await this._saveFeatureContent(message.featureId, message.content, message.frontmatter)
            break
          case 'closeFeature':
            this._currentEditingFeatureId = null
            break
          case 'openFile': {
            const feat = this._repo.features.find(f => f.id === message.featureId)
            if (feat) {
              const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(feat.filePath))
              await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside })
            }
            break
          }
          case 'openSettings':
            vscode.commands.executeCommand('workbench.action.openSettings', '@ext:LachyFS.kanban-markdown')
            break
          case 'focusMenuBar':
            // Focus must leave the webview before focusMenuBar works (VS Code limitation).
            // Use Activity Bar (not Side Bar) — it's always visible and won't expand a collapsed sidebar.
            await vscode.commands.executeCommand('workbench.action.focusActivityBar')
            await vscode.commands.executeCommand('workbench.action.focusMenuBar')
            break
          case 'toggleColumnCollapsed': {
            const collapsed: string[] = this._context.workspaceState.get('kanban-markdown.collapsedColumns', [])
            const idx = collapsed.indexOf(message.columnId)
            if (idx >= 0) {
              collapsed.splice(idx, 1)
            } else {
              collapsed.push(message.columnId)
            }
            await this._context.workspaceState.update('kanban-markdown.collapsedColumns', collapsed)
            break
          }
          case 'setBoardViewMode': {
            await this._context.workspaceState.update('kanban-markdown.boardViewMode', message.mode)
            break
          }
          case 'toggleEpicCollapsed': {
            const collapsedEpics: string[] = this._context.workspaceState.get('kanban-markdown.collapsedEpics', [])
            const idx = collapsedEpics.indexOf(message.epicKey)
            if (idx >= 0) {
              collapsedEpics.splice(idx, 1)
            } else {
              collapsedEpics.push(message.epicKey)
            }
            await this._context.workspaceState.update('kanban-markdown.collapsedEpics', collapsedEpics)
            break
          }
          case 'moveAllCards':
            await this._moveAllCards(message.sourceColumnId, message.targetColumnId, message.epicLane)
            break
          case 'archiveAllCards':
            await this._archiveAllCards(message.sourceColumnId)
            break
          case 'renameLabel':
            await this._renameLabel(message.oldName, message.newName)
            break
          case 'deleteLabel':
            await this._deleteLabel(message.labelName)
            break
          case 'startWithAI': {
            if (!vscode.workspace.isTrusted) {
              vscode.window.showWarningMessage(t('panel.aiRequiresTrust'))
              return
            }
            const feature = this._repo.features.find(f => f.id === this._currentEditingFeatureId)
            if (feature) {
              const config = vscode.workspace.getConfiguration('kanban-markdown')
              const agent = message.agent || config.get<string>('aiAgent') || 'claude'
              this._launcher.launch(feature, agent, message.permissionMode || 'default')
            }
            break
          }
          case 'laneAction': {
            if (!vscode.workspace.isTrusted) {
              vscode.window.showWarningMessage(t('panel.aiRequiresTrust'))
              return
            }
            const laneFeatures = (message.featureIds as string[])
              .map((id: string) => this._repo.features.find(f => f.id === id))
              .filter((f): f is Feature => f !== undefined)
            if (laneFeatures.length === 0) return
            const laneConfig = vscode.workspace.getConfiguration('kanban-markdown')
            const laneColumns = laneConfig.get<KanbanColumn[]>('columns', DEFAULT_COLUMNS)
            const laneColumn = laneColumns.find(c => c.id === message.columnId)
              ?? DEFAULT_COLUMNS.find(c => c.id === message.columnId)
              ?? { id: message.columnId, name: message.columnId, color: '' }
            const laneAgent = laneConfig.get<string>('aiAgent') || 'claude'
            this._launcher.launchLane(laneFeatures, laneColumn, laneAgent, 'default')
            break
          }
        }
      },
      null,
      this._disposables
    )

    // Subscribe to repo changes
    this._repo.onDidChange(newFeatures => {
      this._sendFeaturesToWebview()
      if (this._currentEditingFeatureId && !this._savingFeatureContent) {
        const feature = newFeatures.find(f => f.id === this._currentEditingFeatureId)
        if (feature) {
          const currentSerialized = serializeFeature(feature)
          if (currentSerialized !== this._lastSentEditorContent) {
            this._sendFeatureContent(this._currentEditingFeatureId)
          }
        } else {
          // Feature was deleted externally — clear editing state so saves don't silently fail
          this._currentEditingFeatureId = null
          this._panel.webview.postMessage({ type: 'featureDeleted' })
        }
      }
    }, null, this._disposables)

    // Listen for settings changes and push updates to webview
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('kanban-markdown')) {
        if (e.affectsConfiguration('kanban-markdown.language')) {
          reloadBundle()
        }
        if (e.affectsConfiguration('kanban-markdown.featuresDirectory')) {
          this._repo.load()
        } else {
          this._sendFeaturesToWebview()
          if (e.affectsConfiguration('kanban-markdown.filenamePattern')) {
            this._promptFilenamePatternMigration()
          }
          if (e.affectsConfiguration('kanban-markdown.language')) {
            this._promptColumnLanguageMigration()
          }
        }
      } else if (e.affectsConfiguration('chat.disableAIFeatures')) {
        this._sendFeaturesToWebview()
      }
    }, null, this._disposables)
  }

  public onDispose(callback: () => void): void {
    this._onDisposeCallbacks.push(callback)
  }

  public dispose() {
    KanbanPanel.currentPanel = undefined

    for (const cb of this._onDisposeCallbacks) {
      cb()
    }
    this._onDisposeCallbacks = []

    this._panel.dispose()

    while (this._disposables.length) {
      const x = this._disposables.pop()
      if (x) {
        x.dispose()
      }
    }
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview)
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'index.js')
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'style.css')
    )

    const nonce = this._getNonce()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>Kanban Board</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }

  private _getNonce(): string {
    return crypto.randomBytes(24).toString('base64url')
  }


  public triggerCreateDialog(): void {
    this._panel.webview.postMessage({ type: 'triggerCreateDialog' })
  }

  public openFeature(featureId: string): void {
    const config = vscode.workspace.getConfiguration('kanban-markdown')
    if (config.get<boolean>('markdownEditorMode', false)) {
      this._openFeatureInNativeEditor(featureId)
    } else {
      this._sendFeatureContent(featureId)
    }
  }

  private async _moveAllCards(
    sourceColumnId: string,
    targetColumnId: string,
    epicLane?: string | null
  ): Promise<void> {
    await this._repo.moveAllFeatures(sourceColumnId, targetColumnId, epicLane)
  }

  private async _archiveAllCards(sourceColumnId: string): Promise<void> {
    const source = this._repo.features.filter(f => f.status === sourceColumnId)
    if (source.length === 0) return
    const count = source.length
    const archiveMsg = count === 1 ? t('panel.archiveConfirmOne') : t('panel.archiveConfirmOther', { count })
    const archiveButton = t('panel.archiveButton')
    const confirm = await vscode.window.showWarningMessage(archiveMsg, { modal: true }, archiveButton)
    if (confirm !== archiveButton) return
    const { failedCount } = await this._repo.archiveFeatures(sourceColumnId)
    if (failedCount > 0) {
      const failMsg = failedCount === 1 ? t('panel.archiveFailedOne') : t('panel.archiveFailedOther', { count: failedCount })
      vscode.window.showWarningMessage(failMsg)
    }
  }

  private async _deleteLabel(labelName: string): Promise<void> {
    const trimmed = labelName.trim()
    if (!trimmed) return

    const affected = this._repo.features.filter(f => f.labels.includes(trimmed))
    if (affected.length === 0) return

    const count = affected.length
    const removeMsg = count === 1
      ? t('panel.removeLabelOne', { label: trimmed })
      : t('panel.removeLabelOther', { label: trimmed, count })
    const removeButton = t('panel.removeButton')
    const confirm = await vscode.window.showWarningMessage(removeMsg, { modal: true }, removeButton)
    if (confirm !== removeButton) return
    await this._repo.deleteLabel(trimmed)
  }

  private async _renameLabel(oldName: string, newName: string): Promise<void> {
    await this._repo.renameLabel(oldName, newName)
  }

  private async _openFeatureInNativeEditor(featureId: string): Promise<void> {
    const feature = this._repo.features.find(f => f.id === featureId)
    if (!feature) return

    // Use a fixed column beside the panel so repeated clicks reuse the same split
    const panelColumn = this._panel.viewColumn ?? vscode.ViewColumn.One
    const targetColumn = panelColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.Beside

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(feature.filePath))
    await vscode.window.showTextDocument(doc, { viewColumn: targetColumn, preview: true })
  }

  private async _sendFeatureContent(featureId: string): Promise<void> {
    const feature = this._repo.features.find(f => f.id === featureId)
    if (!feature) return

    this._currentEditingFeatureId = featureId

    const frontmatter: FeatureFrontmatter = {
      id: feature.id,
      status: feature.status,
      priority: feature.priority,
      assignee: feature.assignee,
      epic: feature.epic,
      dueDate: feature.dueDate,
      created: feature.created,
      modified: feature.modified,
      completedAt: feature.completedAt,
      labels: feature.labels,
      order: feature.order
    }

    this._lastSentEditorContent = serializeFeature(feature)

    this._panel.webview.postMessage({
      type: 'featureContent',
      featureId: feature.id,
      content: feature.content,
      frontmatter
    })
  }

  private async _saveFeatureContent(
    featureId: string,
    content: string,
    frontmatter: FeatureFrontmatter
  ): Promise<void> {
    const updates: Partial<Feature> = {
      content,
      status: frontmatter.status,
      priority: frontmatter.priority,
      assignee: frontmatter.assignee,
      epic: frontmatter.epic,
      dueDate: frontmatter.dueDate,
      labels: frontmatter.labels
    }
    this._savingFeatureContent = true
    try {
      await this._repo.updateFeature(featureId, updates)
    } finally {
      this._savingFeatureContent = false
    }
    const feature = this._repo.features.find(f => f.id === featureId)
    if (feature) this._lastSentEditorContent = serializeFeature(feature)
  }

  private async _promptFilenamePatternMigration(): Promise<void> {
    const count = this._repo.features.length
    if (count === 0) return

    const filenameMsg = count === 1
      ? t('panel.filenameChangedOne')
      : t('panel.filenameChangedOther', { count })
    const renameButton = t('panel.renameButton')
    const answer = await vscode.window.showInformationMessage(
      filenameMsg,
      renameButton,
      t('panel.keepExisting')
    )
    if (answer !== renameButton) return

    await this._migrateFilenames()
  }

  private async _promptColumnLanguageMigration(): Promise<void> {
    const config = vscode.workspace.getConfiguration('kanban-markdown')
    const columns = config.get<KanbanColumn[]>('columns')
    if (!columns || columns.length === 0) return

    // Check if all column names are known defaults (from any locale)
    const knownDefaults = getAllDefaultColumnNames()
    const allAreDefaults = columns.every(col => knownDefaults.has(col.name))
    if (!allAreDefaults) return // User has custom column names, don't prompt

    // Check if columns already match the new locale
    const locale = getEffectiveLocale()
    const newNames = getDefaultColumnNamesForLocale(locale)
    const alreadyMatches = columns.every(col => col.name === newNames[col.id])
    if (alreadyMatches) return

    const updateButton = t('panel.updateColumns')
    const answer = await vscode.window.showInformationMessage(
      t('panel.languageChanged'),
      updateButton,
      t('panel.keepColumns')
    )
    if (answer !== updateButton) return

    const updatedColumns = columns.map(col => ({
      ...col,
      name: newNames[col.id] ?? col.name
    }))
    await config.update('columns', updatedColumns, vscode.ConfigurationTarget.Workspace)
  }

  private async _migrateFilenames(): Promise<void> {
    const config = vscode.workspace.getConfiguration('kanban-markdown')
    const pattern = config.get<FilenamePattern>('filenamePattern', 'name-date')
    const { renamed, skipped } = await this._repo.migrateFilenames(pattern)
    const msg = skipped > 0
      ? t('panel.renameResultWithSkipped', { renamed, skipped })
      : t('panel.renameResult', { renamed })
    vscode.window.showInformationMessage(`Kanban Markdown: ${msg}`)
  }

  private _sendFeaturesToWebview(): void {
    const config = vscode.workspace.getConfiguration('kanban-markdown')

    const defaultColumns: KanbanColumn[] = [
      { id: 'backlog', name: 'Backlog', color: '#6b7280' },
      { id: 'todo', name: 'To Do', color: '#3b82f6' },
      { id: 'in-progress', name: 'In Progress', color: '#f59e0b' },
      { id: 'review', name: 'Review', color: '#8b5cf6' },
      { id: 'done', name: 'Done', color: '#22c55e' }
    ]
    const columns = config.get<KanbanColumn[]>('columns', defaultColumns)
    const settings: CardDisplaySettings = {
      showPriorityBadges: config.get<boolean>('showPriorityBadges', true),
      showAssignee: config.get<boolean>('showAssignee', true),
      showDueDate: config.get<boolean>('showDueDate', true),
      showLabels: config.get<boolean>('showLabels', true),
      showEpic: config.get<boolean>('showEpic', true),
      showBuildWithAI: config.get<boolean>('showBuildWithAI', true) && !vscode.workspace.getConfiguration('chat').get<boolean>('disableAIFeatures', false),
      showFileName: config.get<boolean>('showFileName', false),
      compactMode: config.get<boolean>('compactMode', false),
      markdownEditorMode: config.get<boolean>('markdownEditorMode', false),
      hideScrollbar: config.get<boolean>('hideScrollbar', false),
      defaultPriority: config.get<Priority>('defaultPriority', 'medium'),
      defaultStatus: config.get<FeatureStatus>('defaultStatus', 'backlog')
    }

    const collapsedColumns: string[] = this._context.workspaceState.get('kanban-markdown.collapsedColumns', [])
    const boardViewMode: BoardViewMode = this._context.workspaceState.get('kanban-markdown.boardViewMode', 'standard')
    const collapsedEpics: string[] = this._context.workspaceState.get('kanban-markdown.collapsedEpics', [])

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const features = this._repo.features.map(f => ({
      ...f,
      filePath: workspaceRoot ? path.relative(workspaceRoot, f.filePath) : f.filePath
    }))

    this._panel.webview.postMessage({
      type: 'init',
      features,
      columns,
      settings,
      collapsedColumns,
      boardViewMode,
      collapsedEpics,
      locale: getEffectiveLocale(),
      translations: getBundle()
    })
  }
}
