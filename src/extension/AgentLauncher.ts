import * as vscode from 'vscode'
import type { Feature, KanbanColumn } from '../shared/types'
import { getTitleFromContent, DEFAULT_COLUMNS } from '../shared/types'
import { buildPrompt, type PromptContext } from './ai/promptBuilder'
import { launchAgentTerminal } from './ai/agentLauncher'
import { t } from './l10n'

export class AgentLauncher {
  constructor(private readonly _extensionUri: vscode.Uri) {}

  launch(feature: Feature, agent: string, permissionMode: string): void {
    if (!vscode.workspace.isTrusted) {
      vscode.window.showWarningMessage(t('panel.aiRequiresTrust'))
      return
    }

    const workspaceRoot =
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(feature.filePath))?.uri.fsPath
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      ?? null

    const config = vscode.workspace.getConfiguration('kanban-markdown')
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

    launchAgentTerminal(
      agent || 'claude',
      permissionMode || 'default',
      prompt,
      workspaceRoot ?? undefined,
      terminalTitle
    )
  }
}
