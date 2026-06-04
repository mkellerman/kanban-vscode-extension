import * as path from 'path'
import * as vscode from 'vscode'
import type { Feature, KanbanColumn } from '../shared/types'
import { getTitleFromContent, DEFAULT_COLUMNS } from '../shared/types'
import { buildPrompt, buildLanePrompt, type PromptContext } from './ai/promptBuilder'
import { launchAgentTerminal } from './ai/agentLauncher'
import { t } from './l10n'

export class AgentLauncher {
  private readonly _activeTerminals = new Map<vscode.Terminal, string[]>()
  private readonly _onAgentStatusChanged = new vscode.EventEmitter<{ featureIds: string[]; active: boolean }>()
  readonly onAgentStatusChanged = this._onAgentStatusChanged.event
  private readonly _terminalSub: vscode.Disposable

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._terminalSub = vscode.window.onDidCloseTerminal(terminal => {
      const featureIds = this._activeTerminals.get(terminal)
      if (!featureIds) return
      this._activeTerminals.delete(terminal)
      const stillActive = new Set(this.activeFeatureIds)
      const nowInactive = featureIds.filter(id => !stillActive.has(id))
      if (nowInactive.length > 0) {
        this._onAgentStatusChanged.fire({ featureIds: nowInactive, active: false })
      }
    })
  }

  get activeFeatureIds(): string[] {
    const ids = new Set<string>()
    for (const featureIds of this._activeTerminals.values()) {
      for (const id of featureIds) ids.add(id)
    }
    return Array.from(ids)
  }

  dispose(): void {
    this._terminalSub.dispose()
    this._onAgentStatusChanged.dispose()
  }

  launch(feature: Feature, agent: string, permissionMode: string, effectiveRoot?: string | null): void {
    if (!vscode.workspace.isTrusted) {
      vscode.window.showWarningMessage(t('panel.aiRequiresTrust'))
      return
    }

    const workspaceRoot =
      effectiveRoot
      ?? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(feature.filePath))?.uri.fsPath
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      ?? null

    const config = vscode.workspace.getConfiguration('kanban-extension')
    const columns = config.get<KanbanColumn[]>('columns', DEFAULT_COLUMNS)
    const column = columns.find(c => c.id === feature.status)
      ?? { id: feature.status, name: feature.status, color: '' }

    const ctx: PromptContext = {
      title: getTitleFromContent(feature.content),
      status: feature.status,
      priority: feature.priority,
      labels: feature.labels,
      content: feature.content,
      filePath: feature.filePath
    }

    const prompt = buildPrompt(ctx, column, this._extensionUri.fsPath, workspaceRoot)
    const terminalTitle = `${column.name}: ${ctx.title}`

    const terminal = launchAgentTerminal(
      agent || 'claude',
      permissionMode || 'default',
      prompt,
      workspaceRoot ?? undefined,
      terminalTitle
    )
    this._activeTerminals.set(terminal, [feature.id])
    this._onAgentStatusChanged.fire({ featureIds: [feature.id], active: true })
  }

  launchLane(
    features: Feature[],
    column: KanbanColumn,
    agent: string,
    permissionMode: string
  ): void {
    if (!vscode.workspace.isTrusted) {
      vscode.window.showWarningMessage(t('panel.aiRequiresTrust'))
      return
    }

    const firstFilePath = features[0]?.filePath
    const workspaceFolder = firstFilePath
      ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(firstFilePath))?.uri.fsPath ?? null
      : null
    const workspaceRoot = workspaceFolder
    const cwd = workspaceFolder
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      ?? (firstFilePath ? path.dirname(firstFilePath) : undefined)

    const prompt = buildLanePrompt(features, column, this._extensionUri.fsPath, workspaceRoot)
    const terminalTitle = `Scrum Master: ${column.name}`

    const terminal = launchAgentTerminal(
      agent || 'claude',
      permissionMode || 'default',
      prompt,
      cwd,
      terminalTitle
    )
    const featureIds = features.map(f => f.id)
    this._activeTerminals.set(terminal, featureIds)
    this._onAgentStatusChanged.fire({ featureIds, active: true })
  }
}
